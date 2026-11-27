package org.hearme.sample

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.hearme.rider.HearMeBeacon

/** Minimal rider app: one button turns the phone into a HearMe e-bike beacon. */
class MainActivity : Activity() {
    private var beacon: HearMeBeacon? = null
    private lateinit var status: TextView
    private val locationManager by lazy { getSystemService(LOCATION_SERVICE) as LocationManager }
    private val listener = LocationListener { loc ->
        beacon?.update(loc)
        status.text = "Beacon ON · %.1f km/h · ±%.0f m · %d packets built".format(loc.speed * 3.6, loc.accuracy, beacon?.packetsBuilt ?: 0)
    }

    private val perms: Array<String>
        get() = if (Build.VERSION.SDK_INT >= 31)
            arrayOf(Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.ACCESS_FINE_LOCATION)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this).apply { textSize = 20f; text = "Beacon OFF" }
        val toggle = Button(this).apply { textSize = 24f; text = "Start HearMe beacon" }
        toggle.setOnClickListener {
            if (beacon == null) {
                if (perms.any { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }) { requestPermissions(perms, 1); return@setOnClickListener }
                startBeacon(); toggle.text = "Stop HearMe beacon"
            } else { stopBeacon(); toggle.text = "Start HearMe beacon" }
        }
        setContentView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 96, 48, 48); addView(toggle); addView(status) })
    }

    @SuppressLint("MissingPermission")
    private fun startBeacon() {
        beacon = HearMeBeacon(this, type = "e_bike").also { b ->
            if (!b.start()) status.text = b.lastError ?: "Could not start"
        }
        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener)
    }

    private fun stopBeacon() {
        locationManager.removeUpdates(listener)
        beacon?.stop(); beacon = null
        status.text = "Beacon OFF"
    }

    override fun onDestroy() { stopBeacon(); super.onDestroy() }
}
