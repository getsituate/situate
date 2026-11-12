"""Classify Chrome readiness without interacting with first-run controls."""


def browser_state(nodes):
    texts = [node.get("text", "").lower() for node in nodes.iter("node")]
    if any(
        term in text
        for text in texts
        for term in ["terms of service", "accept & continue", "terms of use"]
    ):
        return "terms"
    if any(
        node.get("resource-id") == "com.android.chrome:id/url_bar"
        for node in nodes.iter("node")
    ):
        return "ready"
    return "loading"
