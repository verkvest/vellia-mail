#!/usr/bin/env python3
"""Create the Apple signing material for Vellia Mail.

Reads ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH (the App Store Connect
API key, a .p8 file). The key needs Admin access: Developer cannot create
distribution certificates.

The script registers bundle id es.verkvest.velliamail when it is missing,
creates an iOS Distribution certificate from a local CSR, and creates an
App Store provisioning profile. Push Notifications is not enabled. Set
ENABLE_PUSH=1 only when the TestFlight workflow will also be run with
push turned on.

If Apple refuses another distribution certificate, pass an existing one
with EXISTING_P12_PATH and EXISTING_P12_PASSWORD. The script re-exports
that p12 under a new random password and attaches the matching certificate
to the profile.

This script does not create the app record. Create that in the App Store
Connect web UI before the first upload:

  name: Vellia Mail
  SKU: vellia-mail
  bundle id: es.verkvest.velliamail
  primary language: Russian

Writes signing-out/ (or SIGNING_OUT). github-secrets.txt maps each GitHub
secret name to the file whose contents should be pasted into that secret.
The script prints those paths and never prints secret values.

Requires Python 3.9+ and openssl on PATH. No third-party packages.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.appstoreconnect.apple.com"
BUNDLE_ID = "es.verkvest.velliamail"
BUNDLE_NAME = "Vellia Mail"
CREATE_CERT_TYPES = ("IOS_DISTRIBUTION", "DISTRIBUTION")
MATCH_CERT_TYPES = ("IOS_DISTRIBUTION", "DISTRIBUTION")


class ApiError(Exception):
    def __init__(self, status: int, details: list[str]):
        self.status = status
        self.details = details
        text = "; ".join(details) if details else f"HTTP {status}"
        super().__init__(text)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def der_length(buf: bytes, index: int) -> tuple[int, int]:
    first = buf[index]
    if first < 0x80:
        return first, index + 1
    count = first & 0x7F
    if count == 0 or count > 2:
        raise ValueError("Unsupported DER length")
    end = index + 1 + count
    return int.from_bytes(buf[index + 1 : end], "big"), end


def ecdsa_der_to_raw(der: bytes) -> bytes:
    """Turn an OpenSSL DER ECDSA signature into the 64-byte JOSE form."""
    if not der or der[0] != 0x30:
        raise ValueError("ECDSA signature is not a DER sequence")
    length, index = der_length(der, 1)
    end = index + length
    if end != len(der):
        raise ValueError("ECDSA signature length does not match")
    parts: list[bytes] = []
    for _ in range(2):
        if der[index] != 0x02:
            raise ValueError("ECDSA signature is missing an integer")
        size, index = der_length(der, index + 1)
        raw = der[index : index + size]
        index += size
        raw = raw.lstrip(b"\x00") or b"\x00"
        if len(raw) > 32:
            raise ValueError("ECDSA integer is longer than 32 bytes")
        parts.append(raw.rjust(32, b"\x00"))
    if index != end:
        raise ValueError("ECDSA signature has trailing bytes")
    return parts[0] + parts[1]


def sign_es256(signing_input: bytes, key_path: Path) -> bytes:
    der = subprocess.check_output(
        ["openssl", "dgst", "-sha256", "-sign", str(key_path)],
        input=signing_input,
    )
    return ecdsa_der_to_raw(der)


def make_token(key_id: str, issuer_id: str, key_path: Path) -> str:
    now = int(time.time())
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {
        "iss": issuer_id,
        "iat": now - 30,
        "exp": now + 15 * 60,
        "aud": "appstoreconnect-v1",
    }
    signing_input = ".".join(
        (
            b64url(json.dumps(header, separators=(",", ":")).encode()),
            b64url(json.dumps(payload, separators=(",", ":")).encode()),
        )
    ).encode()
    return signing_input.decode() + "." + b64url(sign_es256(signing_input, key_path))


def error_details(payload: bytes) -> list[str]:
    try:
        body = json.loads(payload.decode() or "{}")
    except json.JSONDecodeError:
        return ["App Store Connect returned a non-JSON error"]
    details = []
    for item in body.get("errors") or []:
        title = item.get("title") or ""
        detail = item.get("detail") or ""
        code = item.get("code") or ""
        text = " ".join(part for part in (code, title, detail) if part).strip()
        if text:
            details.append(text)
    return details or ["App Store Connect rejected the request"]


def api(token: str, method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return json.loads(raw.decode() or "{}")
    except urllib.error.HTTPError as error:
        raise ApiError(error.code, error_details(error.read())) from None


def is_certificate_limit(error: ApiError) -> bool:
    text = " ".join(error.details).lower()
    markers = (
        "already have",
        "maximum",
        "limit",
        "too many",
        "pending certificate",
    )
    return error.status in (403, 409) and any(marker in text for marker in markers)


def find_bundle(token: str) -> str | None:
    query = urllib.parse.urlencode(
        {"filter[identifier]": BUNDLE_ID, "limit": "5"}
    )
    payload = api(token, "GET", f"/v1/bundleIds?{query}")
    for item in payload.get("data") or []:
        if item.get("attributes", {}).get("identifier") == BUNDLE_ID:
            return item["id"]
    return None


def ensure_bundle(token: str) -> str:
    existing = find_bundle(token)
    if existing:
        print(f"Bundle id {BUNDLE_ID} is already registered.")
        return existing
    try:
        created = api(
            token,
            "POST",
            "/v1/bundleIds",
            {
                "data": {
                    "type": "bundleIds",
                    "attributes": {
                        "identifier": BUNDLE_ID,
                        "name": BUNDLE_NAME,
                        "platform": "IOS",
                    },
                }
            },
        )
    except ApiError:
        existing = find_bundle(token)
        if existing:
            print(f"Bundle id {BUNDLE_ID} is already registered.")
            return existing
        raise
    print(f"Registered bundle id {BUNDLE_ID}.")
    return created["data"]["id"]


def enable_push(token: str, bundle_resource_id: str) -> None:
    try:
        api(
            token,
            "POST",
            "/v1/bundleIdCapabilities",
            {
                "data": {
                    "type": "bundleIdCapabilities",
                    "attributes": {"capabilityType": "PUSH_NOTIFICATIONS"},
                    "relationships": {
                        "bundleId": {
                            "data": {"type": "bundleIds", "id": bundle_resource_id}
                        }
                    },
                }
            },
        )
        print("Enabled Push Notifications on the bundle id.")
    except ApiError as error:
        text = " ".join(error.details).lower()
        if error.status == 409 or "already" in text or "exists" in text:
            print("Push Notifications is already enabled on the bundle id.")
            return
        raise


def run_openssl(args: list[str], env_extra: dict[str, str] | None = None, input_bytes: bytes | None = None) -> bytes:
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    return subprocess.check_output(["openssl", *args], input=input_bytes, env=env, stderr=subprocess.PIPE)


def create_certificate(token: str, work: Path) -> tuple[str, Path]:
    key_path = work / "distribution.key"
    csr_path = work / "distribution.csr"
    run_openssl(["genrsa", "-out", str(key_path), "2048"])
    os.chmod(key_path, stat.S_IRUSR | stat.S_IWUSR)
    run_openssl(
        [
            "req",
            "-new",
            "-key",
            str(key_path),
            "-subj",
            "/CN=Vellia Mail Distribution/O=Verkvest SL/C=ES",
            "-out",
            str(csr_path),
        ]
    )
    csr = csr_path.read_text()
    last_error: ApiError | None = None
    limit_error: ApiError | None = None
    for certificate_type in CREATE_CERT_TYPES:
        try:
            created = api(
                token,
                "POST",
                "/v1/certificates",
                {
                    "data": {
                        "type": "certificates",
                        "attributes": {
                            "certificateType": certificate_type,
                            "csrContent": csr,
                        },
                    }
                },
            )
        except ApiError as error:
            last_error = error
            if is_certificate_limit(error):
                limit_error = error
            continue
        encoded = created["data"]["attributes"]["certificateContent"]
        der_path = work / "distribution.cer"
        der_path.write_bytes(base64.b64decode(encoded))
        os.chmod(der_path, stat.S_IRUSR | stat.S_IWUSR)
        print(f"Created an iOS distribution certificate ({certificate_type}).")
        return created["data"]["id"], key_path
    if limit_error:
        raise limit_error
    if last_error:
        raise last_error
    raise ApiError(400, ["App Store Connect did not accept a distribution CSR"])


def list_certificates(token: str) -> list[dict]:
    found: list[dict] = []
    for certificate_type in MATCH_CERT_TYPES:
        query = urllib.parse.urlencode(
            {"filter[certificateType]": certificate_type, "limit": "20"}
        )
        payload = api(token, "GET", f"/v1/certificates?{query}")
        found.extend(payload.get("data") or [])
    return found


def normalize_serial(value: str) -> str:
    text = value.strip().lower()
    if text.startswith("serial="):
        text = text.split("=", 1)[1]
    return text.lstrip("0") or "0"


def certificate_id_for_p12(token: str, p12_path: Path, password: str) -> str:
    cert_pem = run_openssl(
        ["pkcs12", "-in", str(p12_path), "-nokeys", "-passin", "env:P12_PASSWORD"],
        env_extra={"P12_PASSWORD": password},
    )
    serial = run_openssl(["x509", "-noout", "-serial"], input_bytes=cert_pem).decode()
    wanted = normalize_serial(serial)
    for item in list_certificates(token):
        serial_number = item.get("attributes", {}).get("serialNumber") or ""
        if normalize_serial(serial_number) == wanted:
            return item["id"]
    raise SystemExit(
        "The provided p12 does not match an active iOS Distribution certificate in App Store Connect."
    )


def export_p12(key_path: Path, cert_der: Path, password: str, destination: Path) -> None:
    cert_pem = destination.with_suffix(".pem")
    run_openssl(
        ["x509", "-inform", "DER", "-in", str(cert_der), "-out", str(cert_pem)]
    )
    run_openssl(
        [
            "pkcs12",
            "-export",
            "-inkey",
            str(key_path),
            "-in",
            str(cert_pem),
            "-out",
            str(destination),
            "-passout",
            "env:P12_PASSWORD",
        ],
        env_extra={"P12_PASSWORD": password},
    )
    cert_pem.unlink(missing_ok=True)
    os.chmod(destination, stat.S_IRUSR | stat.S_IWUSR)


def reexport_p12(source: Path, source_password: str, password: str, destination: Path) -> None:
    pem = run_openssl(
        [
            "pkcs12",
            "-in",
            str(source),
            "-nodes",
            "-passin",
            "env:P12_PASSWORD",
        ],
        env_extra={"P12_PASSWORD": source_password},
    )
    # OpenSSL 3 does not accept the combined PEM on stdin for pkcs12 -export.
    pem_path = destination.with_suffix(".pem")
    try:
        write_secret_file(pem_path, pem)
        run_openssl(
            [
                "pkcs12",
                "-export",
                "-in",
                str(pem_path),
                "-out",
                str(destination),
                "-passout",
                "env:P12_PASSWORD",
            ],
            env_extra={"P12_PASSWORD": password},
        )
    finally:
        pem_path.unlink(missing_ok=True)
    os.chmod(destination, stat.S_IRUSR | stat.S_IWUSR)


def create_profile(token: str, bundle_resource_id: str, certificate_id: str) -> bytes:
    name = f"Vellia Mail App Store {time.strftime('%Y%m%d%H%M%S')}"
    created = api(
        token,
        "POST",
        "/v1/profiles",
        {
            "data": {
                "type": "profiles",
                "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
                "relationships": {
                    "bundleId": {
                        "data": {"type": "bundleIds", "id": bundle_resource_id}
                    },
                    "certificates": {
                        "data": [{"type": "certificates", "id": certificate_id}]
                    },
                },
            }
        },
    )
    encoded = created["data"]["attributes"]["profileContent"]
    print("Created an App Store provisioning profile.")
    return base64.b64decode(encoded)


def write_secret_file(path: Path, content: bytes) -> None:
    path.write_bytes(content)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def main() -> int:
    key_id = os.environ.get("ASC_KEY_ID", "").strip()
    issuer_id = os.environ.get("ASC_ISSUER_ID", "").strip()
    key_path = Path(os.environ.get("ASC_KEY_PATH", "").strip())
    missing = [
        name
        for name, present in (
            ("ASC_KEY_ID", bool(key_id)),
            ("ASC_ISSUER_ID", bool(issuer_id)),
            ("ASC_KEY_PATH", bool(os.environ.get("ASC_KEY_PATH", "").strip())),
        )
        if not present
    ]
    if missing:
        print("Missing environment: " + ", ".join(missing), file=sys.stderr)
        return 2
    if not key_path.is_file():
        print("ASC_KEY_PATH does not point at a file.", file=sys.stderr)
        return 2

    out_dir = Path(os.environ.get("SIGNING_OUT", "signing-out"))
    out_dir.mkdir(mode=0o700, exist_ok=True)
    os.chmod(out_dir, stat.S_IRWXU)
    work = out_dir / "work"
    work.mkdir(mode=0o700, exist_ok=True)

    token = make_token(key_id, issuer_id, key_path)
    bundle_resource_id = ensure_bundle(token)
    if os.environ.get("ENABLE_PUSH") == "1":
        enable_push(token, bundle_resource_id)
    else:
        print("Push Notifications left off. The profile will not require aps.")

    password = secrets.token_urlsafe(24)
    p12_path = out_dir / "distribution.p12"
    existing_p12 = os.environ.get("EXISTING_P12_PATH", "").strip()
    try:
        certificate_id, private_key = create_certificate(token, work)
        cert_der = work / "distribution.cer"
        export_p12(private_key, cert_der, password, p12_path)
    except ApiError as error:
        if not is_certificate_limit(error):
            print(f"App Store Connect: {error}", file=sys.stderr)
            return 1
        if not existing_p12:
            print(
                "Apple did not issue another distribution certificate. "
                "Set EXISTING_P12_PATH and EXISTING_P12_PASSWORD to an existing iOS Distribution p12.",
                file=sys.stderr,
            )
            return 1
        source = Path(existing_p12)
        source_password = os.environ.get("EXISTING_P12_PASSWORD", "")
        if not source.is_file() or not source_password:
            print(
                "EXISTING_P12_PATH must be a file and EXISTING_P12_PASSWORD must be set.",
                file=sys.stderr,
            )
            return 1
        print("Reused the provided p12 because Apple refused a new distribution certificate.")
        certificate_id = certificate_id_for_p12(token, source, source_password)
        reexport_p12(source, source_password, password, p12_path)
    finally:
        for leftover in work.glob("*"):
            leftover.unlink(missing_ok=True)
        work.rmdir()

    password_path = out_dir / "certificate-password.txt"
    write_secret_file(password_path, password.encode() + b"\n")

    profile = create_profile(token, bundle_resource_id, certificate_id)
    profile_path = out_dir / "profile.mobileprovision"
    write_secret_file(profile_path, profile)
    p12_b64 = out_dir / "distribution.p12.b64"
    profile_b64 = out_dir / "profile.mobileprovision.b64"
    write_secret_file(p12_b64, base64.b64encode(p12_path.read_bytes()) + b"\n")
    write_secret_file(profile_b64, base64.b64encode(profile) + b"\n")

    mapping = out_dir / "github-secrets.txt"
    mapping.write_text(
        "\n".join(
            (
                "# Paste each file's contents into the GitHub secret of the same name.",
                "# This file lists paths only. It does not contain secret values.",
                "#",
                "# The app record itself is not created by this script.",
                "# Create it in App Store Connect: name \"Vellia Mail\", SKU \"vellia-mail\",",
                "# bundle id es.verkvest.velliamail, primary language Russian.",
                "#",
                f"APPLE_CERTIFICATE_P12={p12_b64.as_posix()}",
                f"APPLE_CERTIFICATE_PASSWORD={password_path.as_posix()}",
                f"APP_STORE_PROVISIONING_PROFILE={profile_b64.as_posix()}",
                "",
            )
        )
    )
    os.chmod(mapping, stat.S_IRUSR | stat.S_IWUSR)
    print(f"Wrote {mapping.as_posix()}")
    print("Secret values stay in those files. Nothing secret was printed.")
    print(
        'Create the app in App Store Connect if it is not there yet: name "Vellia Mail", SKU "vellia-mail".'
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ApiError as error:
        print(f"App Store Connect: {error}", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError:
        print("openssl failed. The key, CSR, or p12 could not be processed.", file=sys.stderr)
        sys.exit(1)
