package org.hearme.rider

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.SharedPreferences
import android.location.Location
import android.os.ParcelUuid
import java.security.SecureRandom

/**
 * Turns a rider's phone into a HearMe v1.1 beacon: real HearMe packets (type, rolling ID, speed,
 * heading, GPS position, 4-byte HMAC) as legacy BLE advertising every 100 ms, plus a scan response
 * with the HearMe service UUID. Call [update] with each new location fix (about 1 Hz).
 *
 * Usage (inside a foreground service in a rider/delivery app):
 *   val beacon = HearMeBeacon(context, type = "e_bike", fleetKey = myFleetKey)
 *   beacon.start(); locationUpdates { beacon.update(it) }; ... beacon.stop()
 */
class HearMeBeacon(
    private val context: Context,
    private val type: String = "e_bike",
    private val fleetKey: ByteArray = HearMeCodec.TEST_FLEET_KEY,
    private val clock: () -> Double = { System.currentTimeMillis() / 1000.0 },
) {
    private val advertiser: BluetoothLeAdvertiser? =
        (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter?.bluetoothLeAdvertiser
    private var set: AdvertisingSet? = null
    private var last: Location? = null
    var packetsBuilt = 0L; private set
    var lastError: String? = null; private set

    /** Per-install secret, never broadcast; rolling IDs are derived from it every 10 minutes. */
    private val deviceSecret: ByteArray by lazy {
        val prefs: SharedPreferences = context.getSharedPreferences("hearme_rider", Context.MODE_PRIVATE)
        prefs.getString("device_secret", null)?.let { HearMeCodec.hexToBytes(it) } ?: ByteArray(16).also {
            SecureRandom().nextBytes(it)
            prefs.edit().putString("device_secret", HearMeCodec.bytesToHex(it)).apply()
        }
    }

    /** Builds the current HearMe body from the last location fix (pure; unit-testable). */
    fun buildBody(now: Double = clock(), loc: Location? = last): ByteArray {
        val epoch = HearMeCodec.epochOf(now)
        val fresh = loc != null && (System.currentTimeMillis() - loc.time) < 3000 && loc.hasAccuracy() && loc.accuracy < 20f
        val speed = if (loc != null && loc.hasSpeed()) loc.speed.toDouble() else null
        val heading = if (loc != null && loc.hasBearing() && (speed ?: 0.0) >= 1.0) loc.bearing.toDouble() else null
        val p = HearMeCodec.Packet(
            type = type,
            rollingId = HearMeCodec.rollingId(deviceSecret, epoch),
            speedRaw = HearMeCodec.speedToRaw(speed),
            headingRaw = HearMeCodec.headingToRaw(heading),
            gpsValid = fresh,
            latE7 = loc?.let { Math.round(it.latitude * 1e7).toInt() },
            lonE7 = loc?.let { Math.round(it.longitude * 1e7).toInt() },
        )
        packetsBuilt++
        return HearMeCodec.encode(p, fleetKey, epoch)
    }

    private fun advertiseData(body: ByteArray): AdvertiseData =
        AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addManufacturerData(HearMeCodec.COMPANY_ID, body)
            .build()

    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        val adv = advertiser ?: run { lastError = "Bluetooth LE advertising not supported or Bluetooth off"; return false }
        val params = AdvertisingSetParameters.Builder()
            .setLegacyMode(true)                                        // v1 = legacy 31-byte advertising
            .setConnectable(false)
            .setScannable(true)                                         // v1.1: scan response with service UUID
            .setInterval(AdvertisingSetParameters.INTERVAL_LOW)         // ~100 ms
            .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
            .build()
        val scanResponse = AdvertiseData.Builder().addServiceUuid(ParcelUuid.fromString(HearMeCodec.SERVICE_UUID)).build()
        adv.startAdvertisingSet(params, advertiseData(buildBody()), scanResponse, null, null, object : AdvertisingSetCallback() {
            override fun onAdvertisingSetStarted(s: AdvertisingSet?, txPower: Int, status: Int) {
                if (status == ADVERTISE_SUCCESS) set = s else lastError = "advertising failed: status $status"
            }
            override fun onAdvertisingSetStopped(s: AdvertisingSet?) { set = null }
        })
        return true
    }

    /** Feed each new GPS fix; the advertised packet is rebuilt (speed, heading, position, rolling ID). */
    @SuppressLint("MissingPermission")
    fun update(location: Location) {
        last = location
        set?.setAdvertisingData(advertiseData(buildBody()))
    }

    @SuppressLint("MissingPermission")
    fun stop() {
        set?.let { advertiser?.stopAdvertisingSet(object : AdvertisingSetCallback() {}) }
        set = null
    }
}
