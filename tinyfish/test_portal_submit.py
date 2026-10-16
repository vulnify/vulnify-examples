"""Offline tests: fake Vulnify decisions, no network, no keys."""
from types import SimpleNamespace as NS
import portal_submit as ps
from vulnify import Vulnify

class Fake:
    def __init__(self, d, review=None): self.d, self.review, self.calls = d, review, []
    def check(self, **kw): self.calls.append(kw); return NS(final_decision=self.d, decision=self.d, id="evt_1", degraded=False, reasons=[])
    def wait_for_review(self, eid, timeout): return self.review

def submitted(v):
    hits = []
    out = ps.run("https://portal.example.com/form", {"Name": "A"}, v, lambda u, f: hits.append(f) or {"ok": 1}, 1)
    return out["submitted"], hits

def test_allow():   assert submitted(Fake("ALLOW")) == (True, [{"Name": "A"}])
def test_block():   assert submitted(Fake("BLOCK")) == (False, [])
def test_review_approved(): assert submitted(Fake("REVIEW", "APPROVED"))[0] is True
def test_review_denied():   assert submitted(Fake("REVIEW", "BLOCK")) == (False, [])
def test_review_timeout():  assert submitted(Fake("REVIEW", "TIMEOUT")) == (False, [])
def test_payload():
    f = Fake("BLOCK"); submitted(f)
    c = f.calls[0]; assert c["action"] == "WRITE_DATA" and c["destination"] == "EXTERNAL_API" and c["resource"].endswith("(portal.example.com)")
def test_unreachable_fails_closed():
    v = Vulnify(api_key="vk_fake", base_url="http://127.0.0.1:9", timeout=0.3, retries=0)
    assert submitted(v) == (False, [])
