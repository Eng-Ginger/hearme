package org.hearme.rider

import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HearMe v1.1 packet encoder (Kotlin port of protocol/python/hearme_protocol.py).
 * Byte-identical to the Python, TypeScript and C codecs on protocol/test_vectors.json.
 */
object HearMeCodec {
    const val COMPANY_ID = 0xFFFF
    const val VERSION = 1
    const val EPOCH_SECONDS = 600L
    const val MAX_BODY = 27
    const val SPEED_UNKNOWN = 0xFF
    const val HEADING_UNKNOWN = 0xFF
    const val SERVICE_UUID = "4f2a6c1e-7d3b-4e9a-9c51-8b0d2e6f3a71"

    val TYPES = listOf("e_bike", "e_scooter", "tuk_tuk", "car", "bus", "bus_stop", "crossing", "school_zone", "motorcycle")
    private val INFRA = setOf("bus_stop", "crossing", "school_zone")
    private val DOORS = listOf("front", "middle", "rear", "unknown")

    private const val FLAG_BRAKING = 0x01
    private const val FLAG_GPS_VALID = 0x02
    private const val FLAG_HAS_POSITION = 0x04
    private const val FLAG_REVERSING = 0x08

    data class Packet(
        val type: String,
        val rollingId: ByteArray,               // 4 bytes
        val speedRaw: Int = SPEED_UNKNOWN,      // 0.1 m/s, 255 unknown
        val headingRaw: Int = HEADING_UNKNOWN,  // deg/2, 255 unknown
        val braking: Boolean = false,
        val gpsValid: Boolean = false,
        val reversing: Boolean = false,
        val latE7: Int? = null,
        val lonE7: Int? = null,
        val route: String = "",
        val door: String = "unknown",
        val ramp: Boolean = false,
        val shortCode: Int = 0,
        val name: String = "",
    )

    /** Python: max(0, min(254, int(mps * 10 + 0.5))). */
    fun speedToRaw(mps: Double?): Int =
        if (mps == null) SPEED_UNKNOWN else (mps * 10.0 + 0.5).toInt().coerceIn(0, 254)

    /** Python: int((deg % 360) / 2 + 0.5) % 180. */
    fun headingToRaw(deg: Double?): Int {
        if (deg == null) return HEADING_UNKNOWN
        val d = ((deg % 360.0) + 360.0) % 360.0
        return (d / 2.0 + 0.5).toInt() % 180
    }

    fun epochOf(unixSeconds: Double): Long = Math.floor(unixSeconds / EPOCH_SECONDS).toLong() and 0xFFFFFFFFL

    private fun hmac(key: ByteArray, vararg parts: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        for (p in parts) mac.update(p)
        return mac.doFinal()
    }

    private fun u32le(v: Long): ByteArray = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v.toInt()).array()

    /** Rolling anonymous ID: first 4 bytes of HMAC-SHA256(deviceSecret, "HMid" || epoch LE). */
    fun rollingId(deviceSecret: ByteArray, epoch: Long): ByteArray =
        hmac(deviceSecret, "HMid".toByteArray(Charsets.US_ASCII), u32le(epoch)).copyOf(4)

    /** 4-byte MAC: HMAC-SHA256(fleetKey, "HMv1" || epoch LE || company id LE || body)[0:4]. */
    fun mac(fleetKey: ByteArray, epoch: Long, body: ByteArray): ByteArray {
        val cid = byteArrayOf((COMPANY_ID and 0xFF).toByte(), (COMPANY_ID shr 8).toByte())
        return hmac(fleetKey, "HMv1".toByteArray(Charsets.US_ASCII), u32le(epoch), cid, body).copyOf(4)
    }

    private fun fixedAscii(s: String, n: Int): ByteArray {
        val out = ByteArray(n)
        val chars = s.map { if (it.code < 128) it.code.toByte() else '?'.code.toByte() }
        for (i in 0 until minOf(n, chars.size)) out[i] = chars[i]
        return out
    }

    /** Manufacturer data after the 2-byte company ID (12..27 bytes). */
    fun encode(p: Packet, fleetKey: ByteArray, epoch: Long): ByteArray {
        val code = TYPES.indexOf(p.type)
        require(code >= 0) { "unknown type ${p.type}" }
        require(p.rollingId.size == 4) { "rolling id must be 4 bytes" }
        val infra = p.type in INFRA
        val hasPos = p.latE7 != null && p.lonE7 != null && !infra
        val flags = (if (p.braking) FLAG_BRAKING else 0) or (if (p.gpsValid) FLAG_GPS_VALID else 0) or
            (if (hasPos) FLAG_HAS_POSITION else 0) or (if (p.reversing) FLAG_REVERSING else 0)
        val b = ByteBuffer.allocate(MAX_BODY).order(ByteOrder.LITTLE_ENDIAN)
        b.put(((VERSION shl 4) or code).toByte())
        b.put(p.rollingId)
        b.put(flags.toByte()); b.put(p.speedRaw.toByte()); b.put(p.headingRaw.toByte())
        if (hasPos) { b.putInt(p.latE7!!); b.putInt(p.lonE7!!) }
        if (p.type == "bus") {
            b.put(fixedAscii(p.route, 6))
            b.put(((DOORS.indexOf(p.door).coerceAtLeast(0) and 3) or (if (p.ramp) 4 else 0)).toByte())
        } else if (infra) {
            b.putShort((p.shortCode and 0xFFFF).toShort())
            b.put(fixedAscii(p.name, 12))
        }
        val body = b.array().copyOf(b.position())
        return body + mac(fleetKey, epoch, body)
    }

    /** Full legacy advertising data: one manufacturer-specific AD structure (<= 31 bytes). */
    fun encodeAdv(p: Packet, fleetKey: ByteArray, epoch: Long): ByteArray {
        val body = encode(p, fleetKey, epoch)
        return byteArrayOf((body.size + 3).toByte(), 0xFF.toByte(), (COMPANY_ID and 0xFF).toByte(), (COMPANY_ID shr 8).toByte()) + body
    }

    /** v1.1 scan response: Complete List of 128-bit Service UUIDs with the HearMe UUID (18 bytes). */
    fun encodeScanResponse(): ByteArray {
        val hex = SERVICE_UUID.replace("-", "")
        val be = ByteArray(16) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
        return byteArrayOf(17, 0x07) + be.reversedArray()
    }

    /** The public test fleet key from protocol/test_vectors.json (no security; for demos only). */
    val TEST_FLEET_KEY: ByteArray = hexToBytes("4865617224d650a1c3e79f0b8a2d5e6f1b3c4d5e6f708192a3b4c5d6e7f80910")

    fun hexToBytes(h: String): ByteArray = ByteArray(h.length / 2) { i -> h.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    fun bytesToHex(b: ByteArray): String = b.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
}
