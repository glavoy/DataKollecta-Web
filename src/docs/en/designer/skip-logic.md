# Skip logic

Skip logic makes the questionnaire follow the respondent's answers, so people are only asked what applies to them. Set it on the question editor's **Skip Logic** tab.

Each rule reads: **If** *field* *condition* *value* **then skip to** *question*.

## Pre-skip and post-skip

There are two kinds of rule. They differ in *when* they are checked:

- **Pre-skip** is checked **before this question is shown**. If the rule is true, this question is skipped and the interview jumps to the target. Use it on the question that might not apply: *"Skip the pregnancy questions if the respondent is male."*
- **Post-skip** is checked **after this question is answered**. If the rule is true, the interview jumps to the target. Use it on the question that decides the route: *"After 'Do you smoke?', if No, skip to the alcohol section."*

Both kinds do the same job, so use whichever reads more naturally. Many teams put all their rules as post-skips on the deciding question, so a question's routing is in one place.

## Building a rule

1. Choose **Add Rule** under Pre-Skip Logic or Post-Skip Logic.
2. **If**: choose the field to test. This can be the current question or any earlier one.
3. Choose the **condition**:
   - `=` and `!=`: equal or not equal
   - `<`, `>`, `<=`, `>=`: comparisons, for numbers and dates
   - `contains` and `not contains`: for Multi Select questions, whether a particular option was ticked
4. Set the **value** to compare with:
   - **Fixed value**: a code or number you type, for example `2`.
   - **From field**: another question's answer.
5. **then skip to**: choose the question to jump to, or **End of Form** to finish the form.

A question can have several rules. They are checked in order, and **the first one that is true is used**.

![A pre-skip rule: if enrolled = 0, skip to totvisit](/docs/img/designer/skip-logic.jpg)

## Examples

| Situation | Where | Rule |
|---|---|---|
| Only ask about school for children aged 5–17 | Pre-skip on `in_school` | If `age` `<` `5` then skip to `occupation`, **and** if `age` `>` `17` then skip to `occupation` |
| Skip the smoking details for non-smokers | Post-skip on `smokes` | If `smokes` `=` `2` then skip to `alcohol` |
| End the interview if consent is refused | Post-skip on `consent` | If `consent` `=` `2` then skip to **End of Form** |
| Ask about bed nets only if "malaria" was ticked | Pre-skip on `bednet_use` | If `illnesses` `not contains` `3` then skip to `next_section` |

## Tips

- **Skips only go forward.** Always skip to a question that comes *later* in the form.
- Skipped questions are left blank in the data. That's why exports include a `survey_version` column: a blank can mean "skipped" or "not in that version".
- Comparing with a coded question? The designer warns you if the value isn't one of that question's codes. For example, testing `smokes = 3` when the only options are 1 and 2 would never be true.
- Run the survey in **Test** on a phone and walk every route before you deploy.
