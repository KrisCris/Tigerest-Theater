The certificate and disclosed private key in this directory are public test
fixtures, used only by a temporary TLS server bound to 127.0.0.1. They are not
credentials for any service and must never be used by the application or a
deployed server. The native test host explicitly trusts the fixture certificate
for this request; production uses the default certificate authorities.

Keeping the fixture here allows the transfer regressions to run with Python's
standard library and avoids a cryptography/OpenSSL command-line dependency.
