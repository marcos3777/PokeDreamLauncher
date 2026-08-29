'use strict';

// Itens valiosos informados pelo usuário e destacados na Bolsa.
const RARE_ITEM_NAMES = [
  'Purple Leaf', 'Brown Petal', 'Black Lizard Tail', 'Dark Wing', 'Cyan Ear',
  'Giant Water Cannon', 'Red Piece Of Cocoon', 'Pink Wing', 'Red Cocoon', 'Red Bee Sting',
  'Two-Colored Tail', 'Two-Colored Crest', 'Blue Rat Ear', 'Red Pointy Beak', 'Black Cobra Tail',
  'Shining Claws', 'Green Vampire Wing', 'Brown Poison Bulb', 'Yellow Poison Petal', 'Small Purple Flower',
  'Green Big Mushroom', 'Blue Moth Wing', 'Handful of Yellow Stones', 'White Ball', 'Gray Duck Paw',
  'Metal Bracelet', 'Pristine Small Gloves', 'Pristine Punching Glove', 'Cyan Frog Topknot', 'Enchanted Spoon',
  'Purple Moustache', 'Champion Underwear', 'Master Belt', 'Cyan Leaves', 'Yellow Plant Tail',
  'Emerald', 'Purple Stone Forehead', 'Black Rocks', 'Blue Fire Hoof', 'Unbreakable Shell',
  'Mysterious Necklace', 'Strong Magnet', 'Black Feather', 'Blue Dewgong Tail', 'Disgusting Hand',
  'Dark Claw', 'Dark Ectoplasm', 'Enchanted Pendant', 'Blue Guillotine', 'Big Green Piece',
  'Blue Bone', 'Gray Toxic Scale', 'Golden Drill', 'White Fin', 'Purple Big Tail',
  'Red Gyarados Tail', 'Green Nido Ear', 'Green Queen Ear', 'Blue Nido Ear Ear', 'Blue King Ear',
  'Electric White Ear', 'Blue Wings', 'Big Cute Ear', 'Blue Fox Tail', 'Giant White Fur',
  'Blue Pieces Of Shell', 'Malfunctioning Core', 'Blue Coconut Leaves', 'Yellow Dragon Tail', 'Golden Dragon Tail',
  'Silver Spike Shell', 'Blood Scythe', 'Purple Big Leaf', 'Purple Petal', 'Blaze Fur',
  'Volcano Fur', 'Blue Mohawk', 'Big Blue Mohawk', 'Pink Tail', 'Yellow Crest',
  'Blue Bug Wings', 'Poisoned Arachnid Legs', 'Green Flower', 'White Dandelion', 'Brown Sunflower',
  'Brown Shell', 'Purple Fish Tail', 'Yellow Cute Ears', 'Mud Tail', 'Yellow Tentacle',
  'Electric Soft Wool', 'Green Sheep Tail', 'Psychic Wings', 'Pink Dainty Wing', 'Brown Ear',
  'Black Bear Claw', 'Blue Magma Shell', 'Frozen Tusks', 'Hellhound Horns', 'Orange Elephant Foot',
  'Purple Rock Plate', 'Godzilla Tail', 'Shiny Bat Wing', 'Golden Steelix Tail', "Purple Nurse's Fur",
  'White Dragon Fin', 'Purple Dimensional Cube', 'Electric Rat Tail', 'Purple Moon Topknot', 'Loud Microphone',
  'White Wig', 'Electric White Tail', 'Magma Red Foot', 'Aquatic Long Tail', 'Electric Yellow Collar',
  'Blaze Red Tail', 'Sunlight Ears', 'Moonlight Ears', 'Gray Kick Machine', 'Blue Punching Machine',
  'Capoeira Tail',
];

function canonicalItemName(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

const RARE_ITEM_KEYS = new Set(RARE_ITEM_NAMES.map(canonicalItemName));
const RARE_ITEM_BY_KEY = new Map(RARE_ITEM_NAMES.map((name) => [canonicalItemName(name), name]));

function isRareItem(itemId) {
  return RARE_ITEM_KEYS.has(canonicalItemName(itemId));
}

function rareItemName(itemId) {
  return RARE_ITEM_BY_KEY.get(canonicalItemName(itemId)) || null;
}

module.exports = { RARE_ITEM_NAMES, canonicalItemName, isRareItem, rareItemName };
