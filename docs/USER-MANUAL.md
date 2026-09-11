# Assured PLM & CRM — one-page user manual

Two applications, one sign-in. Switch with the waffle ⊞ at the top left.
Your administrator will give you the address and your own account. A first sign-in asks you to
choose a new password before anything else.

---

## Product Lifecycle — idea to withdrawal

A product moves along **eight development gates**, then across **six market states**. A gate is a decision;
a market state is an observation. The line between them is the **first paid deployment**.

| Do this | Where | What the system insists on |
|---|---|---|
| **Register a product** | Products → New Product | A problem statement and a development route. The route derives the entry gate; overriding it needs a written reason. |
| **Mark exit criteria met** | Product → Gate tab | Each criterion needs an evidence note. You cannot submit until all are met. |
| **Submit a gate** | Product → Submit for approval | Only the **stage owner** submits. The button is absent for everyone else and says who does it. |
| **Approve or return** | Product → Approve gate / Return | Only whoever holds the **approver role for that gate**. Whoever marked the last criterion may not also approve it. |
| **Log effort** | Product → Commercial tab | Days per period per consultant. A gate cannot be approved with no effort recorded. |
| **Record a deployment** | Product → New deployment | The first paid deployment moves the product into **Seeding** and raises launch content on the CRM calendar. |
| **Confirm revenue** | Product → Commercial tab | Finance only. Unconfirmed revenue is excluded from portfolio reporting. |
| **Change a market state** | Product → ⌄ → Change market state | Evidence is mandatory. **Die** (withdrawal) is a CEO decision and is not offered to anyone else. |
| **Park or kill** | Product → ⌄ | Parking needs a resumption date and withdraws any pending gate submission. A kill needs CEO approval and a 50-character closure reason. |

**Home** shows what is waiting on you, what is ageing past its threshold, and what needs a decision. Every tile is clickable.

---

## CRM & Content — lead to invoice

A lead is logged with **nothing but a company name**. What it needs in order to move on is configuration,
not code — see *Setup → Requirement matrix*.

| Do this | Where | What the system insists on |
|---|---|---|
| **Log a lead** | Leads → New Lead | Company name only. Needs *Add a new lead*. |
| **Leave the first stage** | Lead → Edit | The **Estimated Annual Order Value (AED)**. Nothing travels without a number against it. |
| **Set the pipeline** | Lead → Edit | Offering **and** Industry together derive the pipeline and its stages. |
| **Pass the qualification gate ◆** | Lead → Edit | Contact details, segment, channel. **Activity Name** is asked for only when the channel is Online — an Offline channel never asks for it. |
| **Record Activity Name** | Lead → Edit → Activity Name | Choose the **social channel** first, then type a few letters to find the post. It is the same fact as the primary content attribution, so one choice sets both. |
| **Move between stages** | Lead → the stage path, or drag a card on the Pipeline Board | Needs *Move a lead between pipeline stages*. Backward moves need a reason; skipping is off by default. |
| **Close the deal** | Lead → Edit | The **Odoo Invoice Number**, before the lead can reach the Closed band. |
| **Lose a lead** | Lead → Mark lost | A reason of at least 10 characters. The lead keeps the stage it reached, which is what makes "we lose most of them at CSE" answerable. |

### Content Calendar — three views over one dataset

- **Calendar** — the month grid. `+` on any day plans an item there.
- **Table** — the same items as rows, with the engagement figure on each.
- **Targets** — how many items one person should publish, of one content type, on one channel, in one month.
  Achievement is **counted from the calendar**, never typed in, so the two can never disagree.

**Engagement** is two fields that travel together: a whole number, and the unit it is counted in
(*Views*, *Likes*, *Impressions*). One without the other is refused.

A product entering **Seeding** raises a ⚑ launch-content prompt here. Plan it or dismiss it with a reason.

---

## Users and access — Setup → Users

Access is the **union of the roles a person holds and anything granted to them directly**, so
"only these three may move a lead between stages" needs no new role.

1. **New User** → name, email, temporary password.
2. Tick a **role** for the usual bundles (CRM Sales User, Business Head, …), or none.
3. Under **Access**, tick exactly what they may do. The left column is Product Lifecycle, the right is CRM.
   A tick a role already grants is shown locked, naming the role.
4. **Who can do what** shows every person against the permissions that matter, in one grid.

**Gate approval authority is the one thing that cannot be granted here.** It is read from the stage model:
whoever holds the approver role for a gate is the only person who may decide it.

The system refuses any change that would leave nobody able to open this screen.

---

## When something is refused

Every refusal names the business rule and says what to do next. It is the server deciding, never the browser —
the same answer comes back through the API. If a field is blocking a move, the lead record offers
**Record it now** and takes you straight to it.
