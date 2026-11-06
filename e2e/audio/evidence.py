"""Checks that keep a speech sample bound to its intended network experiment."""


def stable_profile(before, after, changes):
    return before == after and all(event.get("config") == before for event in changes)


def verified_path(paths, requested):
    if requested not in ("direct", "udp", "tcp", "tls") or not paths:
        return False
    return all(
        path.get("type") in ("host", "srflx", "prflx") if requested == "direct"
        else path.get("type") == "relay" and path.get("relayProtocol") == requested
        for path in paths
    )
