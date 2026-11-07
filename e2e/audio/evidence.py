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


def planned_outage(before, after, changes, outage):
    """A planned loss interval must be the only profile change, even if restored."""
    expected_drop = {**before, "loss": 1}
    return (before == after and before.get("transport") == "udp" and before.get("proxy") is True
            and len(changes) == 2 and changes[0].get("config") == expected_drop
            and changes[1].get("config") == before
            and changes[0]["at"] <= outage.get("blockedAt", 0)
            and changes[1]["at"] <= outage.get("restoredAt", 0)
            and abs((changes[1]["at"] - changes[0]["at"]) / 1000 - outage["seconds"]) < 0.5
            and outage.get("droppedPackets", 0) > 0)
