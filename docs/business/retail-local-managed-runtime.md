# BMS Retail Local Managed Runtime

Managed Runtime is the commercial self-install direction for Retail Local. The customer downloads one
signed installer, supplies shop/owner/password/PIN details, and reaches a paired POS without handling
Docker Desktop, WSL, Compose, ports, environment files, or a raw device token.

It remains a deployment profile of the authoritative BMS stack. It does not create a local-only price,
stock, payment, permission, tax, or settlement implementation, and Electron remains a keystore-backed
client rather than a server.

## Platform shape

On Windows, a native signed host agent manages a private `BMSRuntime` WSL2 distribution containing
Moby and the pinned BMS services. On Ubuntu, the same agent contract manages Moby through systemd
without virtualization. PostgreSQL data stays on the Linux filesystem; it is never run from `/mnt/c`.
Web and WS remain loopback-only and PostgreSQL, Redis, and the engine socket are never published.

The Windows product boundary is one dedicated operator account per shop host. WSL distributions are
user-scoped and systemd services alone do not keep an instance alive, so the host agent must own
login startup and runtime liveness. A headless server that must run before login is a different
Hyper-V/appliance product and is not implied by this design.

## Supported-target policy

The initial primary targets are serviced Windows 11 x64, Windows 10 IoT Enterprise LTSC 2021 x64,
and Ubuntu 24.04 LTS x64. Windows 10 22H2 is transition-only and needs evidence of current ESU;
Ubuntu 22.04 is transition-only. Consumer Windows 10 without ESU, 32-bit systems, ARM64, arbitrary
Linux distributions, Windows Server, and macOS local server are not initial targets.

Passing preflight means only that a machine is a candidate. A production claim additionally requires
the exact OS/runtime/agent/application combination to pass the clean-install, update, restore,
power-loss, disk-full, suspend/resume, printer/scanner/display, and secret-recovery matrix.

## Install state machine

The installer persists only non-secret progress and resumes after a required reboot:

1. verify the signed installer and support target;
2. enable/install the platform runtime and reboot if required;
3. verify the signed release envelope and stage every component;
4. verify SHA-256 and OCI digests before any provisioning;
5. create machine secrets, migrate, and provision exactly once;
6. pass service and HTTP health checks;
7. transfer the one-time device token to Electron over a local ACL-bound channel, store it with
   `safeStorage`, then erase transient copies;
8. mark installation complete and open the PIN screen.

A failed or interrupted stage resumes idempotently. It must not report success, expose a half-paired
register, or rerun a completed provision operation.

## Update and recovery

Application, runtime, and host-agent releases are separate layers. An update downloads and verifies
all new bytes before stopping the current stack, creates a verified backup before migration, retains
the previous images, and publishes success only after health checks. Image rollback is allowed only
when the release declares schema compatibility; otherwise recovery restores the pre-update database,
files, and encryption keys together.

Live PostgreSQL storage is not backed up by copying a running WSL VHDX. The supported backup is a
logical database dump plus stored files, installation metadata, and the exact secrets required to
decrypt credentials. Commercial recovery must be portable to a replacement machine, so machine-only
DPAPI wrapping cannot be the sole backup key.

Uninstall keeps shop data by default. Permanent erase is a separate, explicit workflow; unregistering
the WSL distribution is destructive and must never occur during an ordinary uninstall.
