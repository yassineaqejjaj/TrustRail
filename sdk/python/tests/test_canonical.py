from trustrail.canonical import canonical_hash, canonical_json


def test_key_order_does_not_affect_output():
    a = canonical_json({"b": 1, "a": 2, "c": {"z": 1, "y": 2}})
    b = canonical_json({"a": 2, "c": {"y": 2, "z": 1}, "b": 1})
    assert a == b


def test_hash_changes_with_value():
    h1 = canonical_hash({"amount_minor": 8000})
    h2 = canonical_hash({"amount_minor": 8001})
    assert h1 != h2


def test_hash_format():
    h = canonical_hash({"x": 1})
    assert h.startswith("sha256:")
    assert len(h) == len("sha256:") + 64
