// The species of the Whitsunday reef and islands as this module draws them. `depth` is the depth range
// (m) the cited page gives where it gives one, otherwise where the module places the species; it is
// negative for land plants (metres above the sea). Facts are quoted or closely paraphrased from the
// cited page, read when this file was written (October 2026); anything that could not be checked was
// left out. Numbers in the facts are the sources' own.
const W = t => 'https://en.wikipedia.org/wiki/' + t;

export const SPECIES = [
  // ---------------------------------------------------------------- fish
  { id: 'chromis', common: 'Blue-green chromis', scientific: 'Chromis viridis', group: 'fish', depth: [1, 12], facts: [
    { text: 'Iridescent apple-green and light blue, reaching at most 10 cm long.', source: W('Chromis_viridis') },
    { text: 'Schools in aggregations around Acropora coral heads.', source: W('Chromis_viridis') },
    { text: 'Found from 1 to 12 m deep, on the Great Barrier Reef among many Indo-Pacific reefs.', source: W('Chromis_viridis') }] },
  { id: 'humbug', common: 'Humbug damselfish', scientific: 'Dascyllus aruanus', group: 'fish', depth: [1, 10], facts: [
    { text: 'White with three black vertical bars; up to 10 cm long, commonly 6 cm.', source: W('Whitetail_dascyllus') },
    { text: 'Lives in groups above Acropora coral heads and rarely strays far from the home it was born in.', source: W('Whitetail_dascyllus') },
    { text: 'Grazes unwanted algae and its waste feeds the coral, which in return gives it shelter.', source: W('Whitetail_dascyllus') }] },
  { id: 'fusilier', common: 'Redbelly yellowtail fusilier', scientific: 'Caesio cuning', group: 'fish', depth: [1, 60], facts: [
    { text: 'Gathers in midwater schools that feed on zooplankton.', source: W('Caesio_cuning') },
    { text: 'The rear of the back and the tail are yellow, the rest of the upper body greyish blue, the belly white or pinkish.', source: W('Caesio_cuning') },
    { text: 'Found from 1 to 60 m, usually above rocky and coral reefs in coastal waters.', source: W('Caesio_cuning') }] },
  { id: 'trevally', common: 'Bigeye trevally', scientific: 'Caranx sexfasciatus', group: 'fish', depth: [1, 100], facts: [
    { text: 'Found in large, slow-moving schools by day; it becomes active at night, when it feeds.', source: W('Bigeye_trevally') },
    { text: 'Known to grow to 120 cm and 18 kg.', source: W('Bigeye_trevally') },
    { text: 'Told apart by a small dark spot on the gill cover and a white-tipped dark second dorsal fin.', source: W('Bigeye_trevally') }] },
  { id: 'parrotfish', common: 'Blue-barred parrotfish', scientific: 'Scarus ghobban', group: 'fish', depth: [1, 20], facts: [
    { text: 'Blue-green to green, commonly about 46 cm long; the fins may carry a pink central stripe.', source: W('Scarus_ghobban') },
    { text: 'Lives over sandy bottoms and seagrass as well as on reef margins, often in small schools.', source: W('Scarus_ghobban') },
    { text: 'Its fast-rotating jaw scrapes the reef and moves fine sediment around.', source: W('Scarus_ghobban') }] },
  { id: 'maori-wrasse', common: 'Humphead (Maori) wrasse', scientific: 'Crassilabrus undulatus (formerly Cheilinus undulatus)', group: 'fish', depth: [2, 60], facts: [
    { text: 'The largest living wrasse: males can reach 229 cm, though about 60 cm is average.', source: W('Humphead_wrasse') },
    { text: 'Thick lips, two black lines behind the eye and a hump on the forehead of large adults.', source: W('Humphead_wrasse') },
    { text: 'One of the reef\'s top predators; it eats invertebrates including the crown-of-thorns starfish.', source: W('Humphead_wrasse') }] },
  { id: 'clownfish', common: 'Barrier Reef anemonefish', scientific: 'Amphiprion akindynos', group: 'fish', depth: [1, 20], facts: [
    { text: 'Found principally on the Great Barrier Reef.', source: W('Amphiprion_akindynos') },
    { text: 'Orange-brown with two black-edged white bars; the tail and the base of the tail are white.', source: W('Amphiprion_akindynos') },
    { text: 'The female is the largest of the group; if she dies the breeding male changes sex and takes her place.', source: W('Amphiprion_akindynos') },
    { text: 'One of 12 anemonefish species that live in the magnificent sea anemone.', source: W('Radianthus_magnifica') }] },
  { id: 'sweetlips', common: 'Harlequin sweetlips', scientific: 'Plectorhinchus chaetodonoides', group: 'fish', depth: [2, 20], facts: [
    { text: 'Ranges across the eastern Indian and western Pacific Oceans, south to the Great Barrier Reef.', source: W('Plectorhinchus_chaetodonoides') },
    { text: 'Adults are grey with large dark brown spots; juveniles are brown with big creamy white blotches.', source: W('Plectorhinchus_chaetodonoides') },
    { text: 'Adults are solitary and shelter beneath ledges; usually about 60 cm, up to 72 cm.', source: W('Plectorhinchus_chaetodonoides') }] },
  // ---------------------------------------------------------------- sharks and rays
  { id: 'blacktip', common: 'Blacktip reef shark', scientific: 'Carcharhinus melanopterus', group: 'shark', depth: [0.5, 15], facts: [
    { text: 'Easily identified by the black tips on its fins, especially the first dorsal fin and the tail.', source: W('Blacktip_reef_shark') },
    { text: 'Typically 1.6 m long; prefers shallow inshore water over reef ledges and sandy flats.', source: W('Blacktip_reef_shark') },
    { text: 'Has a very small home range and may stay in the same area for several years.', source: W('Blacktip_reef_shark') },
    { text: 'Timid and skittish, it seldom poses a danger to people.', source: W('Blacktip_reef_shark') }] },
  { id: 'ribbontail', common: 'Bluespotted ribbontail ray', scientific: 'Taeniura lymma', group: 'ray', depth: [0, 30], facts: [
    { text: 'Lives from the intertidal zone to 30 m on nearshore coral reefs.', source: W('Bluespotted_ribbontail_ray') },
    { text: 'No more than 35 cm wide: electric blue spots on a yellowish disc and two blue stripes along the tail.', source: W('Bluespotted_ribbontail_ray') },
    { text: 'When threatened it flees at high speed in a zigzag; its venomous tail spines can injure people.', source: W('Bluespotted_ribbontail_ray') }] },
  { id: 'eagle-ray', common: 'Whitespotted eagle ray', scientific: 'Aetobatus ocellatus', group: 'ray', depth: [2, 30], facts: [
    { text: 'Dark greenish-grey to almost black above, unlike the paler Atlantic spotted eagle ray it was once lumped with.', source: W('Aetobatus_ocellatus') },
    { text: 'Feeds mainly on snails, bivalves, crustaceans, worms, octopuses and fish.', source: W('Aetobatus_ocellatus') }] },
  { id: 'manta', common: 'Reef manta ray', scientific: 'Mobula alfredi', group: 'ray', depth: [3, 40], facts: [
    { text: 'Typically 3 to 3.5 m across, up to about 5.5 m.', source: W('Reef_manta_ray') },
    { text: 'Described in 1868 by Gerard Krefft of the Australian Museum and named for Alfred, Duke of Edinburgh.', source: W('Reef_manta_ray') },
    { text: 'Lives in shallower, more coastal waters than the giant oceanic manta; individuals can be recognised by their markings.', source: W('Reef_manta_ray') }] },
  // ---------------------------------------------------------------- turtles
  { id: 'green-turtle', common: 'Green sea turtle', scientific: 'Chelonia mydas', group: 'turtle', depth: [0, 25], facts: [
    { text: 'Named for the green fat beneath its shell, not the shell itself, which is olive to black.', source: W('Green_sea_turtle') },
    { text: 'The only sea turtle that is herbivorous as an adult, feeding mostly on seagrasses.', source: W('Green_sea_turtle') },
    { text: 'Sea turtles spend almost all their lives submerged but must surface to breathe air.', source: W('Green_sea_turtle') },
    { text: 'May live to 90 years in the wild.', source: W('Green_sea_turtle') }] },
  { id: 'hawksbill', common: 'Hawksbill sea turtle', scientific: 'Eretmochelys imbricata', group: 'turtle', depth: [0, 25], facts: [
    { text: 'Recognised by its sharp, curving beak and the saw-like edges of its shell.', source: W('Hawksbill_sea_turtle') },
    { text: 'The only reptile that feeds mainly on sponges; it lives mostly in shallow lagoons and on coral reefs.', source: W('Hawksbill_sea_turtle') },
    { text: 'Critically endangered; its shell was the main source of tortoiseshell.', source: W('Hawksbill_sea_turtle') }] },
  // ---------------------------------------------------------------- reef builders and other sessile life
  { id: 'giant-clam', common: 'Giant clam', scientific: 'Tridacna gigas', group: 'clam', depth: [0.5, 20], facts: [
    { text: 'The largest living bivalve: up to 120 cm across and more than 200 kg, living over 100 years.', source: W('Giant_clam') },
    { text: 'Algae in its mantle provide most of its food; it opens by day so they get sunlight.', source: W('Giant_clam') },
    { text: 'Adults cannot close their shells completely, so part of the brownish-yellow mantle always shows.', source: W('Giant_clam') }] },
  { id: 'staghorn', common: 'Branching Acropora (staghorn and bushy forms)', scientific: 'Acropora spp.', group: 'coral', depth: [0.4, 14], facts: [
    { text: 'Over 149 species; among the main builders of the calcium carbonate structure of a reef.', source: W('Acropora') },
    { text: 'Most Acropora are brown or green; a few are brightly coloured.', source: W('Acropora') },
    { text: 'Each polyp is about 2 mm across; polyps extend further at night to catch plankton.', source: W('Acropora') },
    { text: 'Especially susceptible to bleaching: losing their golden-brown algae leaves them stark white.', source: W('Acropora') }] },
  { id: 'table-coral', common: 'Table coral', scientific: 'Acropora hyacinthus', group: 'coral', depth: [1, 25], facts: [
    { text: 'Grows as plates or tables of thin branches in a lattice, on upper reef slopes from 1 to 25 m.', source: W('Acropora_hyacinthus') },
    { text: 'Its diameter increases by 3 to 10 cm a year.', source: W('Acropora_hyacinthus') },
    { text: 'Occurs in the central Pacific and on the Australian east coast; crown-of-thorns starfish preferentially prey on Acropora.', source: W('Acropora_hyacinthus') }] },
  { id: 'porites', common: 'Massive Porites', scientific: 'Porites spp.', group: 'coral', depth: [0.2, 26], facts: [
    { text: 'A Porites colony on the Pandora platform of the Great Barrier Reef grew 10.3 mm a year; the oldest of six colonies there was about 700 years old.', source: W('Porites') },
    { text: 'Massive Porites form characteristic microatolls.', source: W('Porites') }] },
  { id: 'brain-coral', common: 'Lesser valley coral (a brain coral)', scientific: 'Platygyra daedalea', group: 'coral', depth: [0.5, 22], facts: [
    { text: 'Usually forms massive domes or boulders, sometimes a metre or more across.', source: W('Platygyra_daedalea') },
    { text: 'The polyps sit in meandering valleys; the colour varies, and valleys and ridges may contrast.', source: W('Platygyra_daedalea') },
    { text: 'Common across the Indo-Pacific; the IUCN rates it least concern.', source: W('Platygyra_daedalea') }] },
  { id: 'leather-coral', common: 'Leather coral', scientific: 'Sarcophyton spp.', group: 'coral', depth: [1.2, 26], facts: [
    { text: 'A genus of soft corals (family Alcyoniidae).', source: W('Sarcophyton_(coral)') },
    { text: 'Makes a toxic terpene, sarcophytoxide, that deters predators and reduces photosynthesis in the algae of neighbouring Acropora.', source: W('Sarcophyton_(coral)') }] },
  { id: 'anemone', common: 'Magnificent sea anemone', scientific: 'Radianthus magnifica', group: 'anemone', depth: [0, 20], facts: [
    { text: 'Its oral disc is 20 to 50 cm across, sometimes up to 1 m.', source: W('Radianthus_magnifica') },
    { text: 'The column ranges from electric blue to green, red, pink, purple or brown.', source: W('Radianthus_magnifica') },
    { text: 'Lives from the surface to 20 m, on hard ground exposed to light and current.', source: W('Radianthus_magnifica') }] },
  { id: 'seagrass', common: 'Narrowleaf seagrass', scientific: 'Halodule uninervis', group: 'seagrass', depth: [0, 20], facts: [
    { text: 'Grows along the Australian Pacific coast, including the Great Barrier Reef, to 20 m deep.', source: W('Halodule_uninervis') },
    { text: 'Blades up to 15 cm long and usually about 1 mm wide; wider (up to 7 mm) in deeper, cloudier water.', source: W('Halodule_uninervis') },
    { text: 'Adult green turtles feed mostly on seagrasses.', source: W('Green_sea_turtle') }] },
  // ---------------------------------------------------------------- island plants (depth = minus height above the sea)
  { id: 'hoop-pine', common: 'Hoop pine', scientific: 'Araucaria cunninghamii', group: 'tree', depth: [-430, -2], facts: [
    { text: 'The first logging camp on Whitsunday Island was set up in 1861 to cut its large hoop pines for buildings in Bowen.', source: W('Whitsunday_Island') },
    { text: 'A conifer of the dry rainforests of New South Wales, Queensland and New Guinea; it can live 450 years and grow to 60 m.', source: W('Araucaria_cunninghamii') },
    { text: 'Aboriginal Australians used its resin as cement.', source: W('Araucaria_cunninghamii') }] },
  { id: 'carbeen', common: 'Carbeen (Moreton Bay ash), for the islands\' eucalypt woodland', scientific: 'Corymbia tessellaris', group: 'tree', depth: [-430, -2], facts: [
    { text: 'Rough, tessellated grey bark on the lowest 1 to 4 m of the trunk, changing abruptly to smooth whitish bark above.', source: W('Corymbia_tessellaris') },
    { text: 'Typically 30 to 35 m tall, in the open forest and woodland of north-eastern Australia.', source: W('Corymbia_tessellaris') },
    { text: 'Flowers mainly between October and January; the flowers are white.', source: W('Corymbia_tessellaris') }] },
  { id: 'pandanus', common: 'Pandanus (screwpine)', scientific: 'Pandanus tectorius', group: 'tree', depth: [-30, -2], facts: [
    { text: 'Native to eastern Australia from Port Macquarie to northern Queensland; it grows in coastal lowlands near the edge of the ocean.', source: W('Pandanus_tectorius') },
    { text: 'Held up by prop roots; its leaves, 90 to 150 cm long, are spirally arranged at the ends of the branches.', source: W('Pandanus_tectorius') },
    { text: 'Australian Aboriginal peoples ate its seeds and fruit, an important food.', source: W('Pandanus_tectorius') }] },
  { id: 'casuarina', common: 'Coastal she-oak', scientific: 'Casuarina equisetifolia', group: 'tree', depth: [-30, -2], facts: [
    { text: 'Grows near the sea, behind beaches and near estuaries, sometimes on rocky headlands.', source: W('Casuarina_equisetifolia') },
    { text: 'What look like needles are drooping branchlets; the true leaves are tiny scales in whorls of 7 or 8.', source: W('Casuarina_equisetifolia') },
    { text: 'Typically 6 to 12 m tall, sometimes 35 m.', source: W('Casuarina_equisetifolia') }] },
  { id: 'mangrove', common: 'Spotted (stilt-root) mangrove', scientific: 'Rhizophora stylosa', group: 'tree', depth: [-2, 1.2], facts: [
    { text: 'A small to medium evergreen tree up to 15 m tall, native to Queensland and New South Wales among many Pacific coasts.', source: W('Rhizophora_stylosa') },
    { text: 'Grows on sandy beaches and coral terraces on seashores.', source: W('Rhizophora_stylosa') }] }
];
