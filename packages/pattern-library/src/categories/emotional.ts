import type { PatternEntry } from "../types.js";

export const emotionalPatterns: PatternEntry[] = [
  {
    id: "loaded-language",
    name: "Loaded Language",
    category: "emotional",
    definition:
      "A technique that uses words with strong emotional connotations to influence the audience's perception of a subject beyond what the factual content warrants.",
    linguisticMarkers: [
      "outrageous",
      "devastating",
      "radical",
      "catastrophic",
      "disgusting",
      "heroic",
      "groundbreaking",
      "horrifying",
      "stunning",
    ],
    examples: [
      "This devastating policy will annihilate the livelihoods of hardworking families.",
      "The radical agenda of these extremists threatens everything we hold dear.",
      "This horrifying decision exposes the utter contempt they have for ordinary people.",
    ],
    counterExamples: [
      "The policy change will affect approximately 2 million households.",
      "The proposed legislation differs significantly from the current framework.",
      "The decision was met with criticism from several advocacy groups.",
    ],
  },
  {
    id: "euphemism",
    name: "Euphemism",
    category: "emotional",
    definition:
      "A technique that substitutes a mild or indirect expression for one considered too harsh, blunt, or direct, often to minimize the perceived severity of an action or situation.",
    linguisticMarkers: [
      "collateral damage",
      "let go",
      "downsizing",
      "enhanced interrogation",
      "restructuring",
      "passed away",
      "correctional facility",
      "neutralize",
    ],
    examples: [
      "The company is rightsizing its workforce to align with strategic priorities.",
      "The operation resulted in some collateral damage in the surrounding area.",
      "We are implementing a strategic realignment of our human capital resources.",
    ],
    counterExamples: [
      "She passed away peacefully in her sleep at the age of 94.",
      "The restroom is located down the hall on the left.",
      "Please use the facilities before the bus departs.",
    ],
  },
  {
    id: "dysphemism",
    name: "Dysphemism",
    category: "emotional",
    definition:
      "A technique that substitutes a harsh, offensive, or exaggerated expression for a neutral one, often to create a negative perception of the subject.",
    linguisticMarkers: [
      "regime",
      "cronies",
      "scheme",
      "pushing",
      "shove down our throats",
      "bureaucrats",
      "propaganda",
      "brainwashing",
    ],
    examples: [
      "The regime and its cronies are trying to shove this scheme down our throats.",
      "Faceless bureaucrats in Washington are pushing their propaganda on our children.",
      "The corporate fat cats are lining their pockets while workers suffer.",
    ],
    counterExamples: [
      "The administration proposed a new regulatory framework last Tuesday.",
      "Government officials released the policy guidelines for public comment.",
      "Company executives reported increased revenue in the quarterly earnings call.",
    ],
  },
  {
    id: "emotional-hijacking",
    name: "Emotional Hijacking",
    category: "emotional",
    definition:
      "A technique that introduces highly emotional content — often involving children, animals, or tragedy — to bypass rational evaluation of an argument.",
    linguisticMarkers: [
      "think of the children",
      "innocent victims",
      "how would you feel if",
      "imagine your family",
      "no parent should have to",
      "put yourself in their shoes",
    ],
    examples: [
      "Think of the children who will suffer if we don't pass this bill immediately.",
      "How would you feel if this happened to your family? That's why you need to support this.",
      "No parent should ever have to worry about this — vote yes on Proposition 9.",
    ],
    counterExamples: [
      "The proposed playground renovation would serve approximately 500 children in the neighborhood.",
      "Empathy-based training programs have been shown to improve conflict resolution outcomes.",
      "The impact assessment found that the policy would disproportionately affect low-income families.",
    ],
  },
  {
    id: "nostalgia-exploitation",
    name: "Nostalgia Exploitation",
    category: "emotional",
    definition:
      "Invoking an idealised past to trigger emotional attachment and resistance to change.",
    linguisticMarkers: [
      "back in the good old days",
      "remember when things were",
      "it used to be",
      "we've lost something",
      "things were simpler",
      "the way things used to be",
    ],
    examples: [
      "Back in the good old days, people trusted each other — we need to get back to that.",
      "Remember when things were simpler? That's the world this product brings back to you.",
    ],
    counterExamples: [
      "The 1990s housing boom was driven by specific deregulatory policies enacted in 1986.",
      "Historical records show that literacy rates were significantly lower before the 1950s reforms.",
    ],
  },
  {
    id: "moral-outrage",
    name: "Moral Outrage",
    category: "emotional",
    definition:
      "Deliberately triggering outrage to bypass rational evaluation of an argument or proposal.",
    linguisticMarkers: [
      "how dare they",
      "this is an outrage",
      "unacceptable",
      "we cannot stand for this",
      "this should make you angry",
      "are you not furious",
    ],
    examples: [
      "How dare they spend taxpayer money on this while our veterans go homeless!",
      "This should make every parent in this country furious — are you just going to sit there?",
    ],
    counterExamples: [
      "The budget allocation has drawn criticism from veterans' advocacy groups.",
      "Several parents expressed concern at the school board meeting about the curriculum change.",
    ],
  },
  {
    id: "shame-appeal",
    name: "Shame Appeal",
    category: "emotional",
    definition:
      "Using shame or social embarrassment as a motivator to influence behaviour or agreement.",
    linguisticMarkers: [
      "any reasonable person",
      "only a fool would",
      "surely you don't think",
      "you should know better",
      "it's embarrassing that",
      "I can't believe you",
    ],
    examples: [
      "Any reasonable person would see that this is the only viable option.",
      "Surely you don't still believe that — it's embarrassing at this point.",
    ],
    counterExamples: [
      "Most analysts have converged on this interpretation of the data.",
      "The evidence for this position is stronger than for the alternatives.",
    ],
  },
  {
    id: "flattery",
    name: "Flattery",
    category: "emotional",
    definition:
      "Using excessive praise to lower critical defenses before introducing a request or claim.",
    linguisticMarkers: [
      "someone as smart as you",
      "a person of your caliber",
      "you clearly understand",
      "you're one of the few",
      "I knew you'd get it",
      "with your experience",
    ],
    examples: [
      "Someone as smart as you can clearly see why this deal is a no-brainer.",
      "You're one of the few people I trust with this kind of opportunity.",
    ],
    counterExamples: [
      "Your background in this area makes you well-suited to evaluate the proposal.",
      "Thank you for your thorough analysis of the quarterly report.",
    ],
  },
  {
    id: "pity-appeal",
    name: "Pity Appeal",
    category: "emotional",
    definition:
      "Eliciting sympathy to gain agreement or support regardless of the argument's merit.",
    linguisticMarkers: [
      "I've been through so much",
      "you have no idea how hard",
      "after everything I've suffered",
      "please, I'm desperate",
      "have some compassion",
      "if you only knew",
    ],
    examples: [
      "After everything I've been through this year, the least you could do is approve this extension.",
      "You have no idea how hard it's been — please just give me this chance.",
    ],
    counterExamples: [
      "The applicant cited documented medical circumstances as grounds for the deadline extension.",
      "Hardship provisions in the policy allow for case-by-case consideration.",
    ],
  },
];
