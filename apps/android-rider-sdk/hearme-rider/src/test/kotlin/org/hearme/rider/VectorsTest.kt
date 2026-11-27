package org.hearme.rider

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The Kotlin encoder must be byte-identical to the Python/TS/C codecs on the shared vectors. */
class VectorsTest {
    private val root: JsonObject by lazy {
        val repo = System.getProperty("hearme.repo") ?: "../../.."
        JsonParser.parseString(File(repo, "protocol/test_vectors.json").readText()).asJsonObject
    }
    private val key by lazy { HearMeCodec.hexToBytes(root["fleet_key_hex"].asString) }

    private fun packetFrom(f: JsonObject): HearMeCodec.Packet {
        fun opt(k: String) = if (f.has(k) && !f[k].isJsonNull) f[k] else null
        return HearMeCodec.Packet(
            type = f["type"].asString,
            rollingId = HearMeCodec.hexToBytes(f["rolling_id"].asString),
            speedRaw = f["speed_raw"].asInt, headingRaw = f["heading_raw"].asInt,
            braking = f["braking"].asBoolean, gpsValid = f["gps_valid"].asBoolean, reversing = f["reversing"].asBoolean,
            latE7 = opt("lat_e7")?.asInt, lonE7 = opt("lon_e7")?.asInt,
            route = opt("route")?.asString ?: "", door = opt("door")?.asString ?: "unknown", ramp = opt("ramp")?.asBoolean ?: false,
            shortCode = opt("short_code")?.asInt ?: 0, name = opt("name")?.asString ?: "",
        )
    }

    @Test fun everyValidVectorEncodesByteIdentical() {
        var n = 0
        for (e in root["vectors"].asJsonArray) {
            val v = e.asJsonObject
            if (!v["valid"].asBoolean) continue
            val p = packetFrom(v["fields"].asJsonObject)
            val epoch = v["epoch"].asLong
            assertEquals(v["name"].asString, v["payload_hex"].asString, HearMeCodec.bytesToHex(HearMeCodec.encode(p, key, epoch)))
            val adv = HearMeCodec.encodeAdv(p, key, epoch)
            assertEquals(v["name"].asString, v["adv_hex"].asString, HearMeCodec.bytesToHex(adv))
            assertTrue(adv.size <= 31)
            n++
        }
        assertEquals(11, n)
    }

    @Test fun rollingIdMatchesPythonReference() {
        val v0 = root["vectors"].asJsonArray[0].asJsonObject
        val id = HearMeCodec.rollingId("bike-001".toByteArray(), v0["epoch"].asLong)
        assertEquals(v0["fields"].asJsonObject["rolling_id"].asString, HearMeCodec.bytesToHex(id))
    }

    @Test fun scanResponseMatchesVector() {
        val sr = root["scan_response"].asJsonObject
        assertEquals(sr["scan_response_hex"].asString, HearMeCodec.bytesToHex(HearMeCodec.encodeScanResponse()))
        assertEquals(sr["service_uuid"].asString, HearMeCodec.SERVICE_UUID)
    }

    @Test fun conversionsMatchPython() {
        assertEquals(73, HearMeCodec.speedToRaw(7.25)); assertEquals(254, HearMeCodec.speedToRaw(99.0)); assertEquals(255, HearMeCodec.speedToRaw(null))
        assertEquals(0, HearMeCodec.headingToRaw(359.5)); assertEquals(135, HearMeCodec.headingToRaw(-90.0)); assertEquals(255, HearMeCodec.headingToRaw(null))
        assertEquals(3_000_000L, HearMeCodec.epochOf(1_800_000_000.0))
    }
}
