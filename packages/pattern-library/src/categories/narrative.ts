import type { PatternEntry } from "../types.js";

export const narrativePatterns: PatternEntry[] = [
  {
    id: "in-group-out-group",
    name: "In-Group / Out-Group",
    category: "narrative",
    definition:
      "A technique that divides the audience into an in-group ('us') and an out-group ('them') to create solidarity within the in-group and opposition toward the out-group.",
    linguisticMarkers: [
      "people like us",
      "those people",
      "our kind",
      "they don't understand",
      "we real Americans",
      "us versus them",
      "outsiders",
      "our community",
    ],
    examples: [
      "People like us know the value of hard work — unlike those elites who have never worked a day in their lives.",
      "They don't understand our way of life, and they never will.",
      "It's time for real citizens to stand up against the outsiders who threaten our values.",
    ],
    counterExamples: [
      "The study compared outcomes between the treatment group and the control group.",
      "Urban and rural communities face different infrastructure challenges.",
      "The team in the New York office will coordinate with the London office on the project.",
    ],
  },
  {
    id: "enemy-framing",
    name: "Enemy Framing",
    category: "narrative",
    definition:
      "A technique that constructs a specific individual, group, or entity as a threatening adversary responsible for the audience's problems.",
    linguisticMarkers: [
      "the enemy",
      "they are destroying",
      "they want to take away",
      "fighting against us",
      "these people are the reason",
      "they are coming for",
      "the ones responsible",
    ],
    examples: [
      "Big Tech is the enemy of free speech and they want to silence anyone who disagrees.",
      "These bureaucrats are the reason your taxes keep going up and your services keep getting worse.",
      "They are coming for your jobs, your homes, and your way of life.",
    ],
    counterExamples: [
      "The opposing counsel argued that the contract was breached on three specific counts.",
      "Critics of the policy include several nonprofit organizations and two industry groups.",
      "The audit found that the department had exceeded its budget by 18%.",
    ],
  },
  {
    id: "hero-narrative",
    name: "Hero Narrative",
    category: "narrative",
    definition:
      "A technique that positions a person, group, or product as the singular solution to a problem, often implying that no other option exists.",
    linguisticMarkers: [
      "only I can",
      "the one person who",
      "no one else will",
      "single-handedly",
      "the only solution",
      "we alone can fix",
      "the hero we need",
    ],
    examples: [
      "Only I have the experience and courage to fix this broken system.",
      "No one else is willing to tell you the truth — but I am.",
      "We are the only organization fighting for your rights; without us, you have no voice.",
    ],
    counterExamples: [
      "The lead researcher made a breakthrough discovery that advanced the field significantly.",
      "The CEO is credited with turning the company around during a difficult period.",
      "The first responders played a critical role in the rescue operation.",
    ],
  },
  {
    id: "victimhood-framing",
    name: "Victimhood Framing",
    category: "narrative",
    definition:
      "A technique that positions a powerful entity or individual as a victim of persecution or unfair treatment to gain sympathy and deflect criticism.",
    linguisticMarkers: [
      "they're out to get",
      "witch hunt",
      "persecution",
      "silenced",
      "they want to destroy",
      "unfairly targeted",
      "attacked for telling the truth",
    ],
    examples: [
      "This investigation is nothing but a witch hunt designed to silence anyone who speaks the truth.",
      "They are unfairly targeting our company because we challenge the status quo.",
      "The media is out to destroy me because I'm the only one willing to stand up to them.",
    ],
    counterExamples: [
      "The defendant argued that the charges were politically motivated and cited procedural irregularities.",
      "The organization filed a complaint alleging unfair treatment in the regulatory process.",
      "Several journalists reported receiving legal threats after publishing the investigation.",
    ],
  },
  {
    id: "moral-panic",
    name: "Moral Panic",
    category: "narrative",
    definition:
      "Exaggerating a threat to social order to generate fear and demand for immediate action or control.",
    linguisticMarkers: [
      "epidemic of",
      "crisis sweeping",
      "destroying our society",
      "out of control",
      "corrupting our",
      "before it's too late",
      "threatens the fabric of",
    ],
    examples: [
      "There's an epidemic of this behaviour sweeping through our schools — it's destroying our children.",
      "This crisis is out of control and threatens the very fabric of our society.",
    ],
    counterExamples: [
      "The CDC declared an epidemic after cases exceeded the seasonal baseline for six consecutive weeks.",
      "Crime statistics show a 4% increase in the category, consistent with national trends.",
    ],
  },
  {
    id: "scapegoating",
    name: "Scapegoating",
    category: "narrative",
    definition:
      "Attributing complex systemic problems to a single group, individual, or cause.",
    linguisticMarkers: [
      "it's all because of",
      "they are to blame",
      "if it weren't for",
      "the source of all our problems",
      "this is their fault",
      "they are the reason",
    ],
    examples: [
      "All of our economic problems are because of immigrants — it's that simple.",
      "If it weren't for the previous administration, none of this would be happening.",
    ],
    counterExamples: [
      "The investigation identified three contributing factors to the infrastructure failure.",
      "The economic downturn resulted from a combination of supply chain disruptions and policy changes.",
    ],
  },
  {
    id: "inevitability-narrative",
    name: "Inevitability Narrative",
    category: "narrative",
    definition:
      "Presenting a particular outcome as unavoidable to suppress consideration of alternatives.",
    linguisticMarkers: [
      "it's inevitable",
      "there's no stopping",
      "resistance is futile",
      "the future is already here",
      "you can't fight progress",
      "sooner or later",
      "this is happening whether you like it or not",
    ],
    examples: [
      "Automation is inevitable — there's no point resisting it, so you'd better get on board now.",
      "This is happening whether you like it or not; the only question is whether you'll be ready.",
    ],
    counterExamples: [
      "Demographic projections indicate the trend will continue at the current rate through 2040.",
      "Based on adoption curves, the technology is expected to reach 80% market penetration by 2030.",
    ],
  },
  {
    id: "golden-age-narrative",
    name: "Golden Age Narrative",
    category: "narrative",
    definition:
      "Idealising a past era as superior to the present to justify rejecting current developments.",
    linguisticMarkers: [
      "back when things were great",
      "we need to go back to",
      "things used to be better",
      "in the golden age",
      "before everything went wrong",
      "restore what we've lost",
      "make things great again",
    ],
    examples: [
      "We need to go back to the way things were before everything went wrong in this country.",
      "In the golden age of this company, we didn't need all these rules — and we were more successful.",
    ],
    counterExamples: [
      "The company's highest revenue period was 2015-2018, driven by three specific product lines.",
      "Historical data shows that the policy framework from that era had both strengths and documented shortcomings.",
    ],
  },
  {
    id: "destiny-narrative",
    name: "Destiny Narrative",
    category: "narrative",
    definition:
      "Framing a group or individual's actions as part of a predetermined purpose or higher calling.",
    linguisticMarkers: [
      "we were meant to",
      "it's our destiny",
      "called to do this",
      "chosen for this moment",
      "this is what we were born for",
      "it was always going to be us",
    ],
    examples: [
      "We were chosen for this moment — it's our destiny to lead this movement.",
      "This is what we were born to do; history will remember us for answering the call.",
    ],
    counterExamples: [
      "The organisation is uniquely positioned to address this issue given its 20-year track record.",
      "The team's prior experience with similar projects makes them well-suited for this contract.",
    ],
  },
];
