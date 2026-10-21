#pragma once

#include <QByteArray>

// Ed25519 signature verification (RFC 8032) for the signed release feed. Verification only: every
// input is public, so the arithmetic (after TweetNaCl, public domain) need not be constant time.
namespace Ed25519
{
// True when the 64-byte signature is valid for message under the 32-byte public key. A signature whose
// scalar S is not below the group order is rejected, as RFC 8032 requires.
bool verify(const QByteArray& signature, const QByteArray& message, const QByteArray& publicKey);
}
