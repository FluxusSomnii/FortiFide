import type { PatternEntry } from "../types.js";

export const framingPatterns: PatternEntry[] = [
  {
    id: "cherry-picking",
    name: "Cherry Picking",
    category: "framing",
    definition:
      "A technique that selects only data or examples that support a predetermined conclusion while omitting contradictory evidence.",
    linguisticMarkers: [
      "the data clearly shows",
      "the evidence proves",
      "for example",
      "studies confirm",
      "as we can see from",
      "the numbers speak for themselves",
    ],
    examples: [
      "Crime dropped 5% last quarter, proving the new policy works — the overall annual increase of 12% is not mentioned.",
      "This study confirms our product is effective — the three studies that found no effect are not referenced.",
      "As you can see from these selected quarterly results, the company is thriving.",
    ],
    counterExamples: [
      "The meta-analysis reviewed 47 studies, of which 31 found a positive effect and 16 found no significant effect.",
      "Q3 results were strong, though Q1 and Q2 underperformed expectations.",
      "The report includes both favorable and unfavorable safety data from the trial.",
    ],
  },
  {
    id: "misleading-framing",
    name: "Misleading Framing",
    category: "framing",
    definition:
      "A technique that presents information in a way that emphasizes certain aspects while de-emphasizing others to guide interpretation toward a specific conclusion.",
    linguisticMarkers: [
      "the real issue is",
      "what they don't want you to know",
      "if you look at it this way",
      "the untold story",
      "what's really going on",
      "behind the scenes",
    ],
    examples: [
      "The surgery has a 90% survival rate — framing the same data as a 10% mortality rate changes perception.",
      "The real issue isn't the budget — it's that they don't want you to know where the money is really going.",
      "What they're not telling you is that this 'improvement' only benefits a select few.",
    ],
    counterExamples: [
      "The procedure has a 90% survival rate and a 10% complication rate, including a 2% rate of serious complications.",
      "The budget allocates 45% to infrastructure, 30% to education, and 25% to public safety.",
      "The article presents both the benefits and the documented side effects of the treatment.",
    ],
  },
  {
    id: "false-equivalence",
    name: "False Equivalence",
    category: "framing",
    definition:
      "A technique that presents two positions as equally valid or comparable when they have significantly different levels of evidentiary support or moral weight.",
    linguisticMarkers: [
      "both sides",
      "on the other hand",
      "some say...others say",
      "there are two sides to every story",
      "balanced perspective",
      "teach the controversy",
    ],
    examples: [
      "Some scientists say vaccines are safe, but others have concerns — we should teach both sides.",
      "One side says the earth is round, the other says it's flat — there are two sides to every story.",
      "Both the peer-reviewed study and this blog post raise valid points about the treatment.",
    ],
    counterExamples: [
      "The two candidates have different approaches to healthcare reform; here is what each proposes.",
      "Economists are divided on whether the policy will increase or decrease employment in the short term.",
      "Both the prosecution and defense presented evidence for the jury to evaluate.",
    ],
  },
  {
    id: "loss-framing",
    name: "Loss Framing",
    category: "framing",
    definition:
      "Presenting a choice in terms of what will be lost rather than what will be gained to trigger loss aversion.",
    linguisticMarkers: [
      "you'll lose",
      "don't miss out",
      "you're leaving money on the table",
      "you'll never get this back",
      "what you stand to lose",
      "slipping away",
    ],
    examples: [
      "Every day you wait, you're leaving money on the table that you'll never get back.",
      "Don't miss out on this — you'll lose your place and someone else will take it.",
    ],
    counterExamples: [
      "Switching providers may result in a temporary service interruption of up to 48 hours.",
      "The opportunity cost of not investing is approximately 7% annually based on historical returns.",
    ],
  },
  {
    id: "gain-framing",
    name: "Gain Framing",
    category: "framing",
    definition:
      "Presenting a choice exclusively in terms of benefits while obscuring risks or costs.",
    linguisticMarkers: [
      "imagine the upside",
      "think of the savings",
      "you'll gain",
      "the benefits are enormous",
      "all the advantages",
      "nothing to lose",
    ],
    examples: [
      "Think of the savings — you'll gain thousands over the life of this plan, with nothing to lose.",
      "Imagine the upside: more free time, more flexibility, and all the advantages of working for yourself.",
    ],
    counterExamples: [
      "The programme offers tuition reimbursement, though participants must maintain a minimum GPA.",
      "The investment has returned an average of 9% annually, with a standard deviation of 14%.",
    ],
  },
  {
    id: "overton-window-shift",
    name: "Overton Window Shift",
    category: "framing",
    definition:
      "Introducing an extreme position to make a less extreme position seem reasonable by comparison.",
    linguisticMarkers: [
      "at least it's not",
      "compared to what could happen",
      "the alternative is much worse",
      "we could have",
      "some people are calling for",
      "I'm being moderate here",
    ],
    examples: [
      "Some people are calling for a complete ban — I'm just asking for modest regulation.",
      "Compared to what could happen if we do nothing, this small fee is very reasonable.",
    ],
    counterExamples: [
      "The proposal represents a middle ground between full deregulation and the status quo.",
      "Compared to peer institutions, our tuition increase of 3% is below the 5% median.",
    ],
  },
  {
    id: "whataboutism",
    name: "Whataboutism",
    category: "framing",
    definition:
      "Responding to criticism by pointing to a different issue rather than addressing the original concern.",
    linguisticMarkers: [
      "but what about",
      "why don't you talk about",
      "where was the outrage when",
      "what about the time",
      "but they also",
      "why aren't we discussing",
    ],
    examples: [
      "Sure our emissions are high, but what about China — why don't you talk about them?",
      "Where was the outrage when the previous administration did exactly the same thing?",
    ],
    counterExamples: [
      "A related issue worth examining is how other countries have addressed this problem.",
      "For context, the previous policy also faced similar criticism from the same groups.",
    ],
  },
  {
    id: "agenda-setting",
    name: "Agenda Setting",
    category: "framing",
    definition:
      "Controlling which topics are discussed to shape what the audience considers important.",
    linguisticMarkers: [
      "the issue we should be focusing on",
      "what really matters here",
      "let's stay focused on",
      "the only thing that matters",
      "we need to be talking about",
      "the conversation should be about",
    ],
    examples: [
      "The only thing that matters in this election is the economy — everything else is a distraction.",
      "We need to be talking about safety, not about costs. That's what really matters here.",
    ],
    counterExamples: [
      "Given our limited time, I suggest we prioritise the three items flagged as urgent.",
      "The agenda for today's meeting covers budget, staffing, and the Q4 timeline.",
    ],
  },
];
