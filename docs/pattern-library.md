# Forti Fide — Pattern Library

*Version 1.0 — Open source, community-expandable, fully auditable.*

Every pattern in this document is detectable by Forti Fide.
Every pattern is readable inside the app before any capture session begins.
No pattern can be added to the library that cannot be neutrally defined.
If detection requires a value judgement, the pattern does not belong here.

---

## How patterns work

Each pattern entry contains:
- **Name** — plain, neutral, descriptive
- **Register** — which of the five emotional channels it operates in
- **Definition** — what the pattern is, stated without editorial judgement
- **Linguistic markers** — the textual signals Forti Fide looks for
- **Examples** — phrases that would trigger detection
- **Counter-examples** — similar phrases that would not trigger detection
- **Confidence notes** — how reliable detection is for this pattern

---

## The five registers

Every pattern maps to one register. The register shows which emotional
channel is being used — not whether that use is good or bad.

| Register | What it activates |
|----------|-----------------|
| **Fear** | Threat response, urgency, scarcity, danger framing |
| **Identity** | Group membership, in-group/out-group, tribal belonging |
| **Authority** | Deference, credentialism, consensus, legitimacy |
| **Intimacy** | Personal warmth, familiarity, trust, parasocial connection |
| **Rational** | Evidence, uncertainty acknowledgement, hedged claims |

The Rational register is the baseline. Its presence is as informative
as its absence. High Rational register does not mean content is correct —
it means the content uses the markers of reasoned argument.

---

## Manipulation & Coercion

### False Urgency
**Register:** Fear
**Definition:** Artificially compressing the time available for a decision to prevent deliberate evaluation.
**Markers:** "act now", "limited time", "offer expires", "don't miss out", "last chance", "before it's too late"
**Examples:** "This offer expires in 10 minutes." / "Act now before it's too late."
**Counter-examples:** "The deadline for applications is Friday." (genuine deadline, factual)
**Confidence:** High — marker vocabulary is distinctive

### Scarcity Framing
**Register:** Fear
**Definition:** Implying limited availability to increase perceived value and urgency regardless of actual scarcity.
**Markers:** "only X left", "selling fast", "almost gone", "exclusive", "one of a kind", "rare opportunity"
**Examples:** "Only 3 seats remaining." / "This exclusive opportunity won't last."
**Counter-examples:** "We have limited capacity this month." (factual constraint)
**Confidence:** Medium-high — context distinguishes genuine from manufactured scarcity

### Fear Appeal
**Register:** Fear
**Definition:** Using threat of harm, danger, or negative consequences to motivate compliance or belief.
**Markers:** "dangerous", "at risk", "threat to", "under attack", "protect yourself", "before it's too late", catastrophic outcome language
**Examples:** "Your family is at risk if you don't act." / "The threat to our way of life is real."
**Counter-examples:** "Smoking causes lung cancer." (evidence-based risk communication)
**Confidence:** Medium — distinguishing legitimate risk communication from manipulation requires context

### Guilt Induction
**Register:** Intimacy / Fear
**Definition:** Creating or amplifying a sense of personal responsibility for harm to motivate compliance.
**Markers:** "you let down", "because of you", "how could you", "after everything", "don't you care"
**Examples:** "After everything we've done for you, you can't do this one thing?" / "Children are suffering because people like you don't act."
**Counter-examples:** "Your decision affected the team." (factual consequence statement)
**Confidence:** Medium

### Isolation Tactic
**Register:** Fear / Identity
**Definition:** Separating a target from their support network or suggesting their trusted relationships are unreliable.
**Markers:** "they don't really care about you", "only I understand you", "they're turning you against me", "nobody else will tell you this"
**Examples:** "Your friends don't really have your best interests at heart." / "I'm the only one who's honest with you."
**Counter-examples:** "It might help to get a second opinion." (encouraging outside perspective)
**Confidence:** Medium — requires sustained context to detect reliably

---

## Authority & Social Proof

### Appeal to Authority
**Register:** Authority
**Definition:** Citing a person's position or credentials rather than the merits of their argument as justification for a claim.
**Markers:** "experts say", "scientists agree", "according to [credential]", "as [title] X told us"
**Examples:** "Leading economists agree this is the only option." / "As a doctor, I can tell you..."
**Counter-examples:** "The IPCC report finds that..." (citing specific evidence, not just credentials)
**Confidence:** Medium — legitimate expert citation and appeal to authority use similar language

### False Consensus
**Register:** Authority / Identity
**Definition:** Implying that a belief or behaviour is more widely held than it is to create social pressure.
**Markers:** "everyone knows", "nobody seriously believes", "most people agree", "it's well established that", "common sense tells us"
**Examples:** "Everyone knows the system is rigged." / "Nobody seriously disputes this anymore."
**Counter-examples:** "Surveys show 67% of respondents support..." (citing actual measurement)
**Confidence:** High for "everyone knows" / "nobody believes" constructions

### Bandwagon
**Register:** Authority / Identity
**Definition:** Arguing that a position is correct or desirable because many people hold it.
**Markers:** "millions of people can't be wrong", "join the movement", "be part of something bigger", "everyone is switching to"
**Examples:** "Millions of people have already made the switch." / "Join the movement that's changing everything."
**Counter-examples:** "This product has 50,000 verified reviews." (social proof, not logical argument)
**Confidence:** Medium-high

### Manufactured Credibility
**Register:** Authority
**Definition:** Creating the appearance of expertise, endorsement, or legitimacy without substantive basis.
**Markers:** "as seen on", "award-winning", "industry-leading", "world-renowned", "trusted by millions", vague institutional affiliation
**Examples:** "Our award-winning formula..." / "As seen on major networks..."
**Counter-examples:** "We hold ISO 9001 certification." (verifiable specific credential)
**Confidence:** Medium — context and specificity determine whether credentials are genuine

---

## Logical Fallacies

### Ad Hominem
**Register:** Identity / Fear
**Definition:** Attacking the person making an argument rather than the argument itself.
**Markers:** personal attacks, character questioning, credential dismissal, motivation imputation
**Examples:** "Of course he'd say that, he's paid by the industry." / "You can't trust her opinion on this."
**Counter-examples:** "His past statements on this topic contradict his current position." (relevant track record)
**Confidence:** Medium — requires understanding what the argument is

### Straw Man
**Register:** Identity
**Definition:** Misrepresenting an opponent's position to make it easier to attack.
**Markers:** "so you're saying", "what they really mean is", "in other words they want", extreme restatement of mild positions
**Examples:** "So you're saying we should just let anyone do whatever they want?" / "What they really want is to destroy everything we've built."
**Counter-examples:** "If I understand your position correctly, you're arguing that..." (genuine paraphrase seeking confirmation)
**Confidence:** Low-medium — requires knowing the original position being distorted

### False Dichotomy
**Register:** Fear / Identity
**Definition:** Presenting only two options when more exist, often to force a choice between an extreme and a preferred position.
**Markers:** "either...or", "you're with us or against us", "there are only two options", "if not X then Y"
**Examples:** "You're either part of the solution or part of the problem." / "Either we act now or we face catastrophe."
**Counter-examples:** "The two most commonly proposed approaches are X and Y." (acknowledging others exist)
**Confidence:** High for explicit binary constructions

### Slippery Slope
**Register:** Fear
**Definition:** Claiming a relatively small step will inevitably lead to extreme consequences without demonstrating the causal chain.
**Markers:** "next thing you know", "before long", "leads to", "the first step toward", "once we allow", "where does it end"
**Examples:** "If we allow this, next thing you know they'll be banning everything." / "This is the first step toward total control."
**Counter-examples:** "Studies of similar policies in other jurisdictions show the following outcomes..." (evidence-based projection)
**Confidence:** Medium-high

### Circular Reasoning
**Register:** Rational (false)
**Definition:** Using a conclusion as a premise in the argument supporting that conclusion.
**Markers:** restatement of claim as evidence, "because it is", "obviously true therefore true", tautological constructions
**Examples:** "The Bible is true because it says so in the Bible." / "This is the best policy because it's the right thing to do."
**Counter-examples:** "X is supported by evidence Y, which was independently verified by Z." (genuine reasoning chain)
**Confidence:** Low-medium — requires semantic analysis beyond surface markers

---

## Emotional Influence

### Loaded Language
**Register:** Fear / Identity
**Definition:** Using words with strong emotional connotations to influence perception beyond the factual content.
**Markers:** highly charged vocabulary where neutral alternatives exist, dysphemistic or euphemistic substitution
**Examples:** "The regime's propaganda machine..." vs "The government's communications..." / "Freedom fighters" vs "insurgents"
**Counter-examples:** Factual description using standard terminology
**Confidence:** Medium — requires comparison against neutral alternatives

### Euphemism
**Register:** Authority / Identity
**Definition:** Substituting mild or indirect language for something considered too harsh or blunt, often to minimise the significance of negative things.
**Markers:** indirect phrasing for direct actions, sanitising language around harm, bureaucratic distancing
**Examples:** "Enhanced interrogation" / "Collateral damage" / "Downsizing" / "Passed away" (context-dependent)
**Counter-examples:** Direct, plain language for difficult realities
**Confidence:** Medium — context determines whether softening is manipulative or appropriate

### Emotional Hijacking
**Register:** Fear / Intimacy
**Definition:** Using emotionally intense content to bypass deliberative reasoning.
**Markers:** graphic imagery descriptions, extreme emotional appeals, anecdotal override of statistical evidence, "imagine if this were your child"
**Examples:** "Think about your children growing up in a world where..." / "A mother watched helplessly as..."
**Counter-examples:** "Case studies can illustrate systemic patterns. Here is one example alongside the broader data..."
**Confidence:** Medium

### Nostalgia Exploitation
**Register:** Identity / Intimacy
**Definition:** Invoking an idealised past to create longing and imply current decline, without evidential basis.
**Markers:** "used to be", "back when", "remember when", "what happened to", "we've lost", "restore", "take back"
**Examples:** "Remember when you could leave your door unlocked?" / "We need to restore the values that made this great."
**Counter-examples:** "Historical data shows that metric X was higher in period Y." (evidential historical comparison)
**Confidence:** Medium-high for "restore/take back" constructions

---

## Framing & Omission

### Cherry Picking
**Register:** Rational (false)
**Definition:** Selecting only evidence that supports a predetermined conclusion while ignoring contradicting evidence.
**Markers:** Difficult to detect from surface features alone — look for absence of counterevidence acknowledgement in otherwise evidence-citing content
**Examples:** Citing one study while ignoring ten contradicting ones (requires context)
**Counter-examples:** "The evidence is mixed. Studies X and Y support this; studies Z and W do not."
**Confidence:** Low — requires knowledge of omitted evidence

### Misleading Framing
**Register:** All registers
**Definition:** Presenting factually accurate information in a context or with emphasis that creates a false impression.
**Markers:** Selective context, statistical presentation that obscures magnitude, relative vs absolute risk confusion
**Examples:** "Crime increased 100%" (from 1 to 2 incidents) / "9 out of 10 dentists recommend..." (recommend what, compared to what)
**Counter-examples:** "The absolute number of incidents rose from X to Y, representing a Z% change against a baseline of..."
**Confidence:** Low — requires knowing what is omitted

### False Equivalence
**Register:** Authority / Rational (false)
**Definition:** Presenting two things as equivalent when they differ significantly in evidence, scale, or significance.
**Markers:** "both sides", "just as valid", "some say...others say", false balance between evidence-based and non-evidence-based positions
**Examples:** "Some scientists say climate change is happening, others disagree." / "There are arguments on both sides."
**Counter-examples:** "There is scientific consensus on X, though there are legitimate debates about Y."
**Confidence:** Medium-high for explicit "both sides" constructions around asymmetric evidence

---

## Narrative & Identity

### In-Group/Out-Group Construction
**Register:** Identity
**Definition:** Dividing people into us-versus-them categories to create tribal loyalty and hostility toward the out-group.
**Markers:** "people like us", "they want to destroy", "real [nationality/citizens/people]", "elites vs ordinary people", "us vs them"
**Examples:** "Real Americans know what's at stake." / "The elites don't care about people like us."
**Counter-examples:** "People who hold position X tend to prioritise Y, while those who hold position Z prioritise W." (descriptive, not tribal)
**Confidence:** High for explicit "real [group]" and "us vs them" constructions

### Enemy Framing
**Register:** Fear / Identity
**Definition:** Constructing a named or implied enemy as the source of problems and threat to the in-group.
**Markers:** "the real enemy", "they're coming for", "threatened by", "under attack from", named or implied malicious actor
**Examples:** "They're coming for your way of life." / "The real enemy isn't [X], it's [Y]."
**Counter-examples:** "This policy creates conflict between groups A and B by..." (structural analysis)
**Confidence:** Medium-high

### Hero Narrative
**Register:** Identity / Authority
**Definition:** Positioning a person, product, or movement as the singular solution to a significant problem.
**Markers:** "only one who", "finally someone who", "the answer we've been waiting for", "only X can fix this"
**Examples:** "Finally, someone who tells it like it is." / "Only I can fix this."
**Counter-examples:** "This approach has shown the most promising results in comparative studies."
**Confidence:** High for "only X can" constructions

### Victimhood Framing
**Register:** Identity / Intimacy
**Definition:** Positioning the speaker or their group as victims to gain sympathy, deflect criticism, or justify actions.
**Markers:** "persecuted", "attacked", "they're out to get", "no one is defending", "we're not allowed to say"
**Examples:** "We're not even allowed to talk about this anymore." / "They're persecuting us for telling the truth."
**Counter-examples:** "This policy disproportionately affects group X, as evidenced by..."
**Confidence:** Medium

---

## Cognitive Bias Exploitation

### Anchoring
**Register:** Rational (false)
**Definition:** Presenting an initial number or claim that disproportionately influences subsequent judgements.
**Markers:** High opening numbers before negotiation, extreme initial claims before moderation, "originally X, now only Y"
**Examples:** "Originally priced at £999, now only £199." / "Some people say 100,000 jobs will be lost — we think it's more like 10,000."
**Counter-examples:** "The market rate for this is approximately X, based on Y comparable examples."
**Confidence:** Medium-high for pricing anchors, lower for argument anchors

### Availability Heuristic Exploitation
**Register:** Fear
**Definition:** Making rare events seem common by presenting vivid, memorable examples, distorting risk perception.
**Markers:** Vivid anecdote as representative, "this is happening everywhere", repeated unusual incidents, "just last week..."
**Examples:** "Just last week, another [rare event] happened." / "This is becoming an epidemic."
**Counter-examples:** "This type of incident occurs approximately X times per year per 100,000 people, compared to..."
**Confidence:** Medium — requires knowing actual frequency

### Sunk Cost Appeal
**Register:** Fear / Identity
**Definition:** Arguing that past investment justifies continued commitment regardless of current merits.
**Markers:** "we've come too far", "after all we've sacrificed", "we can't stop now", "everything we've worked for"
**Examples:** "We've sacrificed too much to stop now." / "We can't abandon everything we've built."
**Counter-examples:** "Given what we've invested, here is an honest assessment of whether continued investment is warranted."
**Confidence:** Medium-high

---

## Contributing to the pattern library

Forti Fide's pattern library is open source and community-governed.
To propose a new pattern:

1. Open an issue at **github.com/FluxusSomnii/FortiFide/issues**
2. Use the pattern proposal template
3. Include: name, register, neutral definition, linguistic markers,
   examples, counter-examples, confidence assessment
4. A pattern will not be accepted if detection requires a value judgement

The community reviews all proposals. Patterns are versioned — every
change is logged with the reason for the change.

**The one rule:** If you cannot define a pattern neutrally, it does not
belong in this library. The instrument annotates. It does not editorialize.

---

*Forti Fide Pattern Library v1.0 — GPL v3 — fortifide.org*

