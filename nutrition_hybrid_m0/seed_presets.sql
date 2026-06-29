-- Phase 1A authoritative seed. Raw/whole = USDA/FSSAI. recipe = derived. unverified = set from physical pack.
-- basis_qty + basis_unit define ONE unit of the food; resolver scales by (logged_qty / basis_qty).

INSERT INTO presets (name, aliases, basis_qty, basis_unit, cal, protein, carb, fat, fibre, source) VALUES
-- Proteins
('chicken cooked',        '["chicken","chicken breast","chicken curry","chicken meat"]', 100,'g', 195, 27, 0, 9, 0, 'derived'),
('chicken tikka',         '["tikka","chicken tikka"]',                   100,'g',     150, 24,   3,    5,   0,    'recipe'),
('fish cooked',           '["fish","masala fish","dry fish","fish curry"]',100,'g',   105, 19,   0,    3,   0,    'usda'),
('egg boiled',            '["egg","eggs","boiled egg"]',                 1,  'egg',   72,  6.3,  0.4,  4.8, 0,    'usda'),
('egg white',             '["egg white","whites"]',                      1,  'white', 17,  3.6,  0.2,  0.1, 0,    'usda'),
('paneer',                '["paneer"]',                                  100,'g',     265, 18,   3.4,  20,  0,    'fssai'),
('soya chunks dry',       '["soya","soya chunks","soy chunks"]',         100,'g',     345, 52,   33,   0.5, 13,   'fssai'),
('soya chunks cooked',    '["cooked soya","soaked soya"]',               100,'g',     115, 17.3, 11,   0.2, 4.3,  'derived'),
-- Grains / carbs
('besan',                 '["besan","gram flour"]',                      100,'g',     387, 22.4, 57.8, 6.7, 10.8, 'fssai'),
('rice cooked',           '["rice","cooked rice","katori rice"]',        1,  'katori',205, 4.3,  45,   0.4, 0.6,  'usda'),
('roti',                  '["roti","chapati","small roti"]',             1,  'roti',  110, 3.5,  22,   1.5, 3,    'fssai'),
('dal cooked',            '["dal","dal katori"]',                        1,  'katori',120, 7,    20,   2,   5,    'fssai'),
-- Legumes / snacks
('roasted chana',         '["roasted chana","bhuna chana","chana"]',     100,'g',     360, 18,   58,   5,   16,   'fssai'),
('moong sprouts',         '["sprouts","moong sprouts"]',                 1,  'katori',90,  7,    16,   1,   5,    'fssai'),
-- Dairy / liquid
('milk full fat',         '["milk","full fat milk","normal milk","whole milk","doodh"]',100,'ml',61,  3.2,  4.8,  3.5, 0,    'fssai'),
-- Fruit / veg
('apple',                 '["apple"]',                                   1,  'medium',95,  0.5,  25,   0.3, 4.4,  'usda'),
('orange',                '["orange"]',                                  1,  'medium',62,  1.2,  15,   0.2, 3,    'usda'),
('carrot',                '["carrot"]',                                  1,  'medium',25,  0.6,  6,    0.1, 1.7,  'usda'),
('salad',                 '["salad","veg salad","green salad"]',         1,  'bowl',  40,  2,    8,    0.3, 3,    'derived'),
('mixed vegetables',      '["mixed veg","vegetables","sabzi"]',          1,  'bowl',  90,  3,    12,   3.5, 4,    'derived'),
-- Recipe presets (from spec)
('besan chilla',          '["chilla","chillas","besan chilla"]',         1,  'chilla',145, 7.3,  18,   4.5, 3.5,  'recipe'),
('soya chilli',           '["soya chilli","dry soya chilli"]',           1,  'serving',300,30,   30,   8,   7,    'recipe'),
('mixed veg stir fry',    '["stir fry","veg stir fry"]',                 1,  'serving',235,17,   24,   5,   6,    'recipe'),
-- Packaged: VERIFY from pack, do not trust these numbers
('superyou protein',      '["superyou","protein shake","whey"]',         1,  'scoop', 120, 24,   3,    2,   0,    'unverified'),
('superyou protein bar',  '["protein bar","superyou bar"]',              1,  'bar',   150, 10,   16,   6,   3,    'unverified'),
('go zero',               '["go zero","gozero"]',                        100,'g',     95,  4,    16,   3,   5,    'unverified'),
('epigamia greek yogurt', '["epigamia","greek yogurt"]',                 100,'g',     87,  7.9,  5,    4,   0,    'unverified'),
('protein dessert',       '["protein dessert","protein pudding"]',       1,  'serving',350,37,   32,   10,  7,    'unverified');
