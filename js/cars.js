// cars.js. window.CARS data array for Valence Garage v2.
//
// To add a car, append one entry to the CARS array below. Fields:
//   id          short unique string, used as BuildConfig.carId
//   name        display name (real brand allowed in v2)
//   sub         one line descriptor under the name
//   file        relative path to the optimized glb inside the app folder
//   powerHp     baseline power, horsepower
//   weightKg    baseline kerb weight, kilograms
//   drivetrain  'RWD' or 'AWD'
//   wingLevel   integer 0 to 4
//   tireIndex   integer 0 to 3 (0 Touring, 1 Sport, 2 Cup, 3 Slick)
//   accent      hex string, one of the six accent options
//
// Selecting a car in the picker builds a fresh BuildConfig from these
// baseline stats. The 3D model is a fixed mesh: wing and tire changes are
// reflected only in the physics readouts, not in the viewer geometry.

window.CARS = [
  {
    id: 'huayra-r',
    name: 'Pagani Huayra R',
    sub: 'Track-only V12',
    file: 'models/pagani-huayra-r.glb',
    powerHp: 850,
    weightKg: 1070,
    drivetrain: 'RWD',
    wingLevel: 3,
    tireIndex: 3,
    accent: '#C9A84C'
  },
  {
    id: 'tourbillon',
    name: 'Bugatti Tourbillon',
    sub: 'Hyper GT V16',
    file: 'models/bugatti-tourbillon.glb',
    powerHp: 1800,
    weightKg: 1995,
    drivetrain: 'AWD',
    wingLevel: 1,
    tireIndex: 1,
    accent: '#E8D5A0'
  },
  {
    id: 'project-evo',
    name: 'Apollo Project EVO',
    sub: 'Aero devotee',
    file: 'models/apollo-project-evo.glb',
    powerHp: 780,
    weightKg: 1360,
    drivetrain: 'RWD',
    wingLevel: 4,
    tireIndex: 2,
    accent: '#A02020'
  },
  {
    id: 'one1',
    name: 'Koenigsegg One:1',
    sub: 'One to one',
    file: 'models/koenigsegg-one1.glb',
    powerHp: 1360,
    weightKg: 1360,
    drivetrain: 'RWD',
    wingLevel: 2,
    tireIndex: 2,
    accent: '#FAF4F0'
  },
  {
    id: 'valkyrie',
    name: 'Aston Martin Valkyrie',
    sub: 'F1 for the road',
    file: 'models/aston-valkyrie.glb',
    powerHp: 1160,
    weightKg: 1030,
    drivetrain: 'RWD',
    wingLevel: 4,
    tireIndex: 2,
    accent: '#6E1616'
  },
  {
    id: 'f1-93',
    name: 'McLaren F1',
    sub: 'The analog king',
    file: 'models/mclaren-f1-93.glb',
    powerHp: 627,
    weightKg: 1138,
    drivetrain: 'RWD',
    wingLevel: 0,
    tireIndex: 1,
    accent: '#E8C8B4'
  },
  {
    id: 'w14',
    name: 'AMG W14 E Performance',
    sub: 'Formula One weapon',
    file: 'models/amg-w14.glb',
    powerHp: 1000,
    weightKg: 798,
    drivetrain: 'RWD',
    wingLevel: 4,
    tireIndex: 3,
    accent: '#C9A84C'
  },
  {
    id: 'f40',
    name: 'Ferrari F40',
    sub: 'Twin-turbo icon',
    file: 'models/ferrari-f40.glb',
    powerHp: 471,
    weightKg: 1100,
    drivetrain: 'RWD',
    wingLevel: 1,
    tireIndex: 1,
    accent: '#A02020'
  },
  {
    id: 'jesko',
    name: 'Koenigsegg Jesko',
    sub: 'Absolut velocity',
    file: 'models/koenigsegg-jesko.glb',
    powerHp: 1600,
    weightKg: 1420,
    drivetrain: 'RWD',
    wingLevel: 3,
    tireIndex: 2,
    accent: '#FAF4F0'
  },
  {
    id: 'p1',
    name: 'McLaren P1',
    sub: 'Hybrid prophet',
    file: 'models/mclaren-p1.glb',
    powerHp: 916,
    weightKg: 1547,
    drivetrain: 'RWD',
    wingLevel: 2,
    tireIndex: 1,
    accent: '#C9A84C'
  },
  {
    id: 'p900',
    name: 'De Tomaso P900',
    sub: 'Nine hundred kilos of intent',
    file: 'models/de-tomaso-p900.glb',
    powerHp: 900,
    weightKg: 900,
    drivetrain: 'RWD',
    wingLevel: 3,
    tireIndex: 2,
    accent: '#FAF4F0'
  },
  {
    id: 'countach25',
    name: 'Countach LPI 800-4',
    sub: 'The poster, reborn',
    file: 'models/lamborghini-countach-25.glb',
    powerHp: 814,
    weightKg: 1595,
    drivetrain: 'AWD',
    wingLevel: 1,
    tireIndex: 1,
    accent: '#E8D5A0'
  },
  {
    id: 'countach89',
    name: 'Countach 25th Anniversary',
    sub: 'The original poster car',
    file: 'models/lamborghini-countach-89.glb',
    powerHp: 455,
    weightKg: 1490,
    drivetrain: 'RWD',
    wingLevel: 1,
    tireIndex: 0,
    accent: '#A02020'
  },
  {
    id: 'gt3rs',
    name: 'Porsche 911 GT3 RS',
    sub: 'Track weapon, street legal',
    file: 'models/porsche-911-gt3rs.glb',
    powerHp: 525,
    weightKg: 1450,
    drivetrain: 'RWD',
    wingLevel: 3,
    tireIndex: 2,
    accent: '#FAF4F0'
  },
  {
    id: 'mp45',
    name: 'McLaren MP4/5',
    sub: 'Senna\'s office, 1989',
    file: 'models/mclaren-mp45.glb',
    powerHp: 675,
    weightKg: 500,
    drivetrain: 'RWD',
    wingLevel: 4,
    tireIndex: 3,
    accent: '#A02020'
  },
  {
    id: 'apollo-ie',
    name: 'Apollo Intensa Emozione',
    sub: 'The scream made carbon',
    file: 'models/apollo-ie.glb',
    powerHp: 780,
    weightKg: 1250,
    drivetrain: 'RWD',
    wingLevel: 4,
    tireIndex: 2,
    accent: '#C9A84C'
  }
];
