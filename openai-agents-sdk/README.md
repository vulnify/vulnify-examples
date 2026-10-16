# OpenAI Agents SDK (Python) + Vulnify

Shows: a `tool_input_guardrail` that asks Vulnify before each risky `function_tool` runs. On ALLOW the tool runs. On REVIEW or BLOCK, the call is rejected and the model gets the reasons and the event id instead of a result.

> **Stub model, real Vulnify.** `StubModel` is a scripted `agents.models.interface.Model` that requests three tool calls. The real `Runner` and the guardrails run as normal, and the Vulnify checks are real API calls. You don't need an OpenAI key. To use a real model, pass `model="gpt-4.1"` to `Agent(...)`.

## Run it (2 minutes)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && set -a && . ./.env && set +a   # add a TEST key from app.vulnify.io/api-keys
python main.py
pytest -q        # offline, no key needed
```

Set `VULNIFY_AGENT` to an agent that already exists in your org. New names register on first use and count toward your plan's agent limit.

## Expected output

```
send_email team@acme.internal: sent
send_email someone@gmail.com: Vulnify REVIEW (event …): Write operation; Sensitive data detected in content: CPF; External destination; … Not executed; ask the user.
delete_records customers: deleted
side effects: ['send_email -> team@acme.internal', 'delete_records 800 from customers']
```

- The external email contains a CPF, so it goes to REVIEW and never runs.
- On a fresh org, an internal delete scores below the REVIEW threshold. To gate every delete, add a policy in app.vulnify.io (for example, `DELETE_DATA` over 100 records goes to REVIEW). The guard needs no code change.

The valid values for `action` are `READ_DATA`, `WRITE_DATA`, `DELETE_DATA`, `EXPORT_DATA` and `SEND_EMAIL`. The valid values for `destination` are `INTERNAL`, `EXTERNAL_EMAIL` and `EXTERNAL_API`.

Tested live on 2026-10-16 against a Vulnify TEST organization with `openai-agents==0.24.0` and `vulnify==0.4.2`.
