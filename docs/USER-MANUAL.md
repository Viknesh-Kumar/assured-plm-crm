# Assured PLM, CRM and Content Calendar — user manual

Three applications, one sign-in. Switch with the waffle ⊞ at the top left — you see the ones your roles open.
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
| **Record a deployment** | Product → New deployment | The first paid deployment moves the product into **Seeding** and raises a launch-content prompt on the Content Calendar. |
| **Confirm revenue** | Product → Commercial tab | Finance only. Unconfirmed revenue is excluded from portfolio reporting. |
| **Change a market state** | Product → ⌄ → Change market state | Evidence is mandatory. **Die** (withdrawal) is a CEO decision and is not offered to anyone else. |
| **Park or kill** | Product → ⌄ | Parking needs a resumption date and withdraws any pending gate submission. A kill needs CEO approval and a 50-character closure reason. |

**Home** shows what is waiting on you, what is ageing past its threshold, and what needs a decision. Every tile is clickable.

---

## CRM — lead to invoice

A lead is logged with **nothing but a company name**. What it needs in order to move on is configuration,
not code — see *Setup → Requirement matrix*.

| Do this | Where | What the system insists on |
|---|---|---|
| **Log a lead** | Leads → New Lead | Company name only. Needs *Add a new lead*. |
| **Leave the first stage** | Lead → Edit | The **Estimated Annual Order Value (AED)**. Nothing travels without a number against it. |
| **Set the pipeline** | Lead → Edit | Offering **and** Industry together derive the pipeline and its stages. |
| **Pass the qualification gate ◆** | Lead → Edit | Contact details, segment, channel. **Activity Name** is asked for only when the channel is Online — an Offline channel never asks for it. |
| **Record Activity Name** | Lead → Edit → Activity Name | Choose the **social channel** first, then type a few letters to find the post. Only posts with a topic are offered — an open slot on the Content Calendar is not one yet. It is the same fact as the primary content attribution, so one choice sets both. |
| **Move between stages** | Lead → the stage path, or drag a card on the Pipeline Board | Needs *Move a lead between pipeline stages*. Backward moves need a reason; skipping is off by default. |
| **Close the deal** | Lead → Edit | The **Odoo Invoice Number**, before the lead can reach the Closed band. |
| **Lose a lead** | Lead → Mark lost | A reason of at least 10 characters. The lead keeps the stage it reached, which is what makes "we lose most of them at CSE" answerable. |

---

## Content Calendar — from target to results

A **posting target** writes the calendar: which account posts which content type, on which platforms, how many
times a month, in which weeks (1st–4th) and on which weekday, for a run of months. Every post then carries its
type's **stages** — each with the readiness it adds, a turnaround time (TAT) before the posting date, and the role
whose task it is. Deadlines are counted back from the posting date and moved earlier off weekends and holidays,
so **moving a post moves every deadline with it**.

| Do this | Where | What the system insists on |
|---|---|---|
| **Set up a content type** | Setup → Content types & stages | Topic stage first, publishing last at 100% and TAT 0. Readiness rises at every stage; TAT never grows down the list. A reel's footage stage can wait on a video's stage. Needs *Configure content types…* |
| **Set a posting target** | Targets → New target | Posts a month = weeks × weekdays. The preview shows every date before you save — and any clash with another target. Needs *Set and revise the posting targets*. |
| **Change or end a target** | Targets → Change from… / End after… | Untouched slots are replaced; a slot someone has worked on stays, flagged, unless the new pattern wants its date. |
| **Map topics** | Map topics | Topic, content theme and keyword for every slot in the look-ahead. All three close the topic stage; anyone outside its owner role saves a suggestion the owner confirms. |
| **Work the stages** | My tasks, or the post itself | In order, by the role that owns the stage. Overdue work comes first. A reel's footage ticks itself when its video's edit is done. |
| **Publish** | The post → Publish | Every earlier stage done, a link per platform, and a date that is not in the future. |
| **Record figures** | The post → Figures | Per platform, on a capture date, only the metrics that platform reports. Captures fall due on the configured days after publishing. |
| **Move or cancel a post** | The post → Move… / Cancel post… | Once work has started, both need a reason. A cancelled post still counts against its target. |
| **Plan an extra post** | Calendar → Plan an extra post | A date, a content type with a stage list, an account and at least one platform. |
| **Review the month** | Scorecard | Target against planned, published and on time, per account and type, and the figures behind them. **Export month** gives the plan as a spreadsheet. |

A product entering **Seeding** in Product Lifecycle raises a ⚑ launch-content prompt on the calendar.
Plan it as a post, or dismiss it with a reason.

**Setup → Rules & holidays** holds the calendar's rules: the time zone, weekend days, the topic look-ahead,
the due-soon window, the capture days, whether a post link is required, the minimum reason length, the longest
target, the role that runs the calendar, and the daily digest. A change applies at once.

---

## Users and access — Setup → Users

Access is the **union of the roles a person holds and anything granted to them directly**, so
"only these three may move a lead between stages" needs no new role.

1. **New User** → name, email, temporary password.
2. Tick a **role** for the usual bundles (CRM Sales User, Business Head, …), or none.
3. Under **Access**, tick exactly what they may do — one column per application: Product Lifecycle, CRM,
   Content Calendar. *Plan content* opens the Content Calendar; a person holding only that sees no leads.
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
