package top.tigerest.theater

import java.security.MessageDigest

/**
 * Ed25519 signature verification (RFC 8032), the same TweetNaCl-derived arithmetic as src/system/Ed25519.cpp.
 * Android's own provider cannot be relied on for Ed25519, and every input here is public, so this needs no
 * constant-time care. A signature whose scalar S is not below the group order is rejected.
 */
object Ed25519 {
    private fun gf(vararg limbs: Long) = LongArray(16).also { limbs.copyInto(it) }
    private val GF0 = gf()
    private val GF1 = gf(1)
    private val D = gf(0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203)
    private val D2 = gf(0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406)
    private val X = gf(0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169)
    private val Y = gf(0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666)
    private val I = gf(0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83)
    // The group order L, little endian.
    private val L = longArrayOf(0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10)

    /** True when the 64-byte [signature] is valid for [message] under the 32-byte [publicKey]. */
    fun verify(signature: ByteArray, message: ByteArray, publicKey: ByteArray): Boolean {
        if (signature.size != 64 || publicKey.size != 32 || !belowOrder(signature, 32)) return false
        val q = Array(4) { LongArray(16) }
        if (!unpackneg(q, publicKey)) return false
        // h = SHA-512(R || A || M) mod L; the signature holds when S·B - h·A encodes to R.
        val h = MessageDigest.getInstance("SHA-512").run { update(signature, 0, 32); update(publicKey); update(message); digest() }
        reduce(h)
        val p = Array(4) { LongArray(16) }
        scalarmult(p, q, h, 0)
        scalarbase(q, signature, 32)
        add(p, q)
        val t = ByteArray(32)
        pack(t, p)
        return (0 until 32).all { signature[it] == t[it] }
    }

    private fun belowOrder(s: ByteArray, offset: Int): Boolean {
        for (i in 31 downTo 0) {
            val b = s[offset + i].toLong() and 0xff
            if (b < L[i]) return true
            if (b > L[i]) return false
        }
        return false
    }

    private fun set25519(r: LongArray, a: LongArray) = a.copyInto(r)

    private fun car25519(o: LongArray) {
        for (i in 0 until 16) {
            o[i] += 1L shl 16
            val c = o[i] shr 16
            o[if (i < 15) i + 1 else 0] += c - 1 + if (i == 15) 37 * (c - 1) else 0
            o[i] -= c * 65536
        }
    }

    private fun sel25519(p: LongArray, q: LongArray, b: Int) {
        val c = (b - 1).toLong().inv()
        for (i in 0 until 16) {
            val t = c and (p[i] xor q[i])
            p[i] = p[i] xor t
            q[i] = q[i] xor t
        }
    }

    private fun pack25519(o: ByteArray, n: LongArray) {
        val m = LongArray(16); val t = n.copyOf()
        car25519(t); car25519(t); car25519(t)
        repeat(2) {
            m[0] = t[0] - 0xffed
            for (i in 1 until 15) {
                m[i] = t[i] - 0xffff - ((m[i - 1] shr 16) and 1)
                m[i - 1] = m[i - 1] and 0xffff
            }
            m[15] = t[15] - 0x7fff - ((m[14] shr 16) and 1)
            val b = ((m[15] shr 16) and 1).toInt()
            m[14] = m[14] and 0xffff
            sel25519(t, m, 1 - b)
        }
        for (i in 0 until 16) {
            o[2 * i] = (t[i] and 0xff).toByte()
            o[2 * i + 1] = (t[i] shr 8).toByte()
        }
    }

    private fun neq25519(a: LongArray, b: LongArray): Boolean {
        val c = ByteArray(32); val d = ByteArray(32)
        pack25519(c, a); pack25519(d, b)
        return !c.contentEquals(d)
    }

    private fun par25519(a: LongArray): Int {
        val d = ByteArray(32)
        pack25519(d, a)
        return d[0].toInt() and 1
    }

    private fun unpack25519(o: LongArray, n: ByteArray) {
        for (i in 0 until 16) o[i] = (n[2 * i].toLong() and 0xff) + ((n[2 * i + 1].toLong() and 0xff) shl 8)
        o[15] = o[15] and 0x7fff
    }

    private fun A(o: LongArray, a: LongArray, b: LongArray) { for (i in 0 until 16) o[i] = a[i] + b[i] }
    private fun Z(o: LongArray, a: LongArray, b: LongArray) { for (i in 0 until 16) o[i] = a[i] - b[i] }

    private fun M(o: LongArray, a: LongArray, b: LongArray) {
        val t = LongArray(31)
        for (i in 0 until 16) for (j in 0 until 16) t[i + j] += a[i] * b[j]
        for (i in 0 until 15) t[i] += 38 * t[i + 16]
        t.copyInto(o, 0, 0, 16)
        car25519(o); car25519(o)
    }

    private fun S(o: LongArray, a: LongArray) = M(o, a, a)

    private fun inv25519(o: LongArray, input: LongArray) {
        val c = input.copyOf()
        for (a in 253 downTo 0) { S(c, c); if (a != 2 && a != 4) M(c, c, input) }
        set25519(o, c)
    }

    private fun pow2523(o: LongArray, input: LongArray) {
        val c = input.copyOf()
        for (a in 250 downTo 0) { S(c, c); if (a != 1) M(c, c, input) }
        set25519(o, c)
    }

    // Points are extended coordinates (X, Y, Z, T).
    private fun add(p: Array<LongArray>, q: Array<LongArray>) {
        val a = LongArray(16); val b = LongArray(16); val c = LongArray(16); val d = LongArray(16); val t = LongArray(16)
        val e = LongArray(16); val f = LongArray(16); val g = LongArray(16); val h = LongArray(16)
        Z(a, p[1], p[0]); Z(t, q[1], q[0]); M(a, a, t)
        A(b, p[0], p[1]); A(t, q[0], q[1]); M(b, b, t)
        M(c, p[3], q[3]); M(c, c, D2)
        M(d, p[2], q[2]); A(d, d, d)
        Z(e, b, a); Z(f, d, c); A(g, d, c); A(h, b, a)
        M(p[0], e, f); M(p[1], h, g); M(p[2], g, f); M(p[3], e, h)
    }

    private fun cswap(p: Array<LongArray>, q: Array<LongArray>, b: Int) { for (i in 0 until 4) sel25519(p[i], q[i], b) }

    private fun pack(r: ByteArray, p: Array<LongArray>) {
        val tx = LongArray(16); val ty = LongArray(16); val zi = LongArray(16)
        inv25519(zi, p[2]); M(tx, p[0], zi); M(ty, p[1], zi)
        pack25519(r, ty)
        r[31] = (r[31].toInt() xor (par25519(tx) shl 7)).toByte()
    }

    private fun scalarmult(p: Array<LongArray>, q: Array<LongArray>, s: ByteArray, offset: Int) {
        set25519(p[0], GF0); set25519(p[1], GF1); set25519(p[2], GF1); set25519(p[3], GF0)
        for (i in 255 downTo 0) {
            val b = ((s[offset + i / 8].toInt() and 0xff) shr (i and 7)) and 1
            cswap(p, q, b); add(q, p); add(p, p); cswap(p, q, b)
        }
    }

    private fun scalarbase(p: Array<LongArray>, s: ByteArray, offset: Int) {
        val q = Array(4) { LongArray(16) }
        set25519(q[0], X); set25519(q[1], Y); set25519(q[2], GF1); M(q[3], X, Y)
        scalarmult(p, q, s, offset)
    }

    private fun modL(r: ByteArray, x: LongArray) {
        for (i in 63 downTo 32) {
            var carry = 0L
            var j = i - 32
            while (j < i - 12) {
                x[j] += carry - 16 * x[i] * L[j - (i - 32)]
                carry = (x[j] + 128) shr 8
                x[j] -= carry * 256
                j++
            }
            x[j] += carry
            x[i] = 0
        }
        var carry = 0L
        for (j in 0 until 32) {
            x[j] += carry - (x[31] shr 4) * L[j]
            carry = x[j] shr 8
            x[j] = x[j] and 255
        }
        for (j in 0 until 32) x[j] -= carry * L[j]
        for (i in 0 until 32) {
            x[i + 1] += x[i] shr 8
            r[i] = (x[i] and 255).toByte()
        }
    }

    // Reduces a 64-byte little-endian number modulo L into its first 32 bytes.
    private fun reduce(r: ByteArray) {
        val x = LongArray(64) { r[it].toLong() and 0xff }
        r.fill(0)
        modL(r, x)
    }

    // Decodes the negated point of a public key; false when it is not on the curve.
    private fun unpackneg(r: Array<LongArray>, p: ByteArray): Boolean {
        val t = LongArray(16); val chk = LongArray(16); val num = LongArray(16); val den = LongArray(16)
        val den2 = LongArray(16); val den4 = LongArray(16); val den6 = LongArray(16)
        set25519(r[2], GF1)
        unpack25519(r[1], p)
        S(num, r[1]); M(den, num, D); Z(num, num, r[2]); A(den, r[2], den)
        S(den2, den); S(den4, den2); M(den6, den4, den2); M(t, den6, num); M(t, t, den)
        pow2523(t, t); M(t, t, num); M(t, t, den); M(t, t, den); M(r[0], t, den)
        S(chk, r[0]); M(chk, chk, den)
        if (neq25519(chk, num)) M(r[0], r[0], I)
        S(chk, r[0]); M(chk, chk, den)
        if (neq25519(chk, num)) return false
        if (par25519(r[0]) == ((p[31].toInt() and 0xff) shr 7)) Z(r[0], GF0, r[0])
        M(r[3], r[0], r[1])
        return true
    }
}
