-- Sample data for the Weatherlend prototype. All names and items are examples.
-- Safe to re-run: it clears the tables first.
DELETE FROM ledger; DELETE FROM loans; DELETE FROM needs; DELETE FROM item_phenomena; DELETE FROM items;
DELETE FROM user_phenomena; DELETE FROM users; DELETE FROM neighbourhoods; DELETE FROM size_categories; DELETE FROM phenomena;

INSERT INTO phenomena (id, slug, name, short_name, tint, ink, sort) VALUES
(1,'heat-wave','Heat wave','Heat wave','#F8DDD0','#9A4A2A',1),
(2,'cold-snap','Cold snap','Cold snap','#DCE5F4','#2F4F86',2),
(3,'heavy-rain','Heavy rain and flooding','Heavy rain','#D5EDE6','#1F6A57',3),
(4,'storm','Storm','Storm','#E5DEF4','#5A3E96',4),
(5,'snow-ice','Snow and ice','Snow and ice','#D9ECF3','#2A6378',5),
(6,'drought','Drought and water shortage','Drought','#F4E9C6','#7A5D12',6),
(7,'power-outage','Power outage','Power outage','#E3E3E8','#43434F',7);
INSERT INTO size_categories (slug, name, points_per_day, examples, sort) VALUES
('small','Small',1,'boots, lantern',1),
('medium','Medium',2,'fan, heater',2),
('large','Large',3,'air conditioner, vacuum',3);
INSERT INTO neighbourhoods (name) VALUES ('Affoltern'), ('Albisrieden'), ('Altstadt'), ('Altstetten'), ('Aussersihl'), ('Enge'), ('Fluntern'), ('Friesenberg'), ('Hirslanden'), ('Hottingen'), ('Höngg'), ('Industriequartier'), ('Leimbach'), ('Oberstrass'), ('Oerlikon'), ('Riesbach'), ('Schwamendingen'), ('Seebach'), ('Unterstrass'), ('Wiedikon'), ('Wipkingen'), ('Witikon'), ('Wollishofen');
INSERT INTO users (id, name, neighbourhood) VALUES (1,'Lea','Oerlikon'), (2,'Marco','Altstetten'), (3,'Aylin','Wiedikon'), (4,'Jonas','Seebach'), (5,'Sven','Höngg'), (6,'Mira','Enge');
INSERT INTO user_phenomena (user_id, phenomenon_id) VALUES (5,2),(5,3),(1,1),(3,2);
INSERT INTO items (id, owner_id, name, size, available_from_month, available_until_month, availability_note, neighbourhood, description) VALUES
(1,1,'Floor fan 40 cm','medium',6,8,NULL,'Oerlikon','Three speeds, quiet at night. Pick-up after 6 pm.'),
(2,2,'Portable air conditioner','large',6,8,NULL,'Altstetten','Exhaust hose and window kit included. Heavy, best with two people.'),
(3,3,'Cooler box 25 L','small',5,9,NULL,'Wiedikon','Keeps food cold for about a day with ice packs.'),
(4,4,'Balcony sun sail','small',6,8,NULL,'Seebach','3 × 3 m with ropes and hooks.'),
(5,5,'Fan heater 2000 W','medium',11,2,NULL,'Höngg','Two heat levels and frost protection mode.'),
(6,6,'Electric blanket','medium',11,2,NULL,'Enge','Double-bed size, washable cover.'),
(7,3,'Down sleeping bag','small',10,3,NULL,'Hirslanden','Comfort down to −5 °C.'),
(8,5,'Wet and dry vacuum','large',NULL,NULL,'short notice, all year','Höngg','20 L tank, works for flooded cellars.'),
(9,6,'Dehumidifier','medium',NULL,NULL,'short notice, all year','Enge','Removes up to 12 L per day.'),
(10,4,'Rubber boots size 42','small',NULL,NULL,NULL,'Seebach',NULL),
(11,2,'Sandbags, set of 10','medium',NULL,NULL,'short notice, all year','Altstetten','Filled, about 15 kg each. Car needed.'),
(12,1,'Window storm film kit','small',NULL,NULL,NULL,'Oerlikon','Enough film for two windows.'),
(13,5,'Snow shovel and grit','small',12,2,NULL,'Höngg','Shovel plus one 10 kg bag of grit.'),
(14,3,'Rain barrel 200 L','large',4,9,NULL,'Wiedikon','With tap and lid.'),
(15,6,'Watering cans, set of 3','small',4,9,NULL,'Enge',NULL),
(16,4,'Power bank 25''000 mAh','small',NULL,NULL,NULL,'Seebach','Two USB-C ports, charges a laptop once.'),
(17,1,'Camping stove with gas','small',NULL,NULL,NULL,'Oerlikon','One spare gas cartridge.'),
(18,2,'LED lanterns, set of 4','small',NULL,NULL,NULL,'Altstetten','Battery powered, about 20 h each.');
INSERT INTO item_phenomena (item_id, phenomenon_id, sort) VALUES (1,1,0), (2,1,0), (3,1,0), (3,7,1), (4,1,0), (4,4,1), (5,2,0), (6,2,0), (7,2,0), (7,7,1), (8,3,0), (9,3,0), (10,3,0), (10,5,1), (11,3,0), (11,4,1), (12,4,0), (13,5,0), (14,6,0), (14,3,1), (15,6,0), (16,7,0), (16,1,1), (17,7,0), (18,7,0), (18,4,1);
INSERT INTO loans (id, item_id, lender_id, borrower_id, start_date, end_date, days, points, status, created_at) VALUES
(1,5,5,2,'2026-02-10','2026-02-12',3,6,'accepted','2026-02-10 08:00:00'),
(2,2,2,5,'2026-07-20','2026-07-20',1,3,'accepted','2026-07-20 08:00:00'),
(3,1,1,5,'2026-08-03','2026-08-04',2,4,'accepted','2026-08-03 08:00:00'),
(4,6,6,5,'2026-11-04','2026-11-06',3,6,'accepted','2026-11-04 08:00:00'),
(5,5,5,1,'2026-11-14','2026-11-20',7,14,'accepted','2026-11-14 08:00:00'),
(6,18,2,5,'2026-11-18','2026-11-19',2,2,'accepted','2026-11-18 08:00:00'),
(7,8,5,4,'2026-11-09','2026-11-10',2,6,'pending','2026-11-09 08:00:00'),
(8,9,6,5,'2026-11-25','2026-11-27',3,6,'pending','2026-11-25 08:00:00'),
(9,10,4,3,'2026-09-14','2026-09-15',2,2,'accepted','2026-09-14 08:00:00');
INSERT INTO ledger (user_id, amount, kind, loan_id, created_at) VALUES
(1,10,'welcome',NULL,'2026-01-15 09:00:00'),
(2,10,'welcome',NULL,'2026-01-15 09:00:00'),
(3,10,'welcome',NULL,'2026-01-15 09:00:00'),
(4,10,'welcome',NULL,'2026-01-15 09:00:00'),
(5,10,'welcome',NULL,'2026-01-15 09:00:00'),
(6,10,'welcome',NULL,'2026-01-15 09:00:00'),
(2,-6,'borrow',1,'2026-02-10 08:00:00'),
(5,6,'lend',1,'2026-02-10 08:00:00'),
(5,-3,'borrow',2,'2026-07-20 08:00:00'),
(2,3,'lend',2,'2026-07-20 08:00:00'),
(5,-4,'borrow',3,'2026-08-03 08:00:00'),
(1,4,'lend',3,'2026-08-03 08:00:00'),
(5,-6,'borrow',4,'2026-11-04 08:00:00'),
(6,6,'lend',4,'2026-11-04 08:00:00'),
(1,-14,'borrow',5,'2026-11-14 08:00:00'),
(5,14,'lend',5,'2026-11-14 08:00:00'),
(5,-2,'borrow',6,'2026-11-18 08:00:00'),
(2,2,'lend',6,'2026-11-18 08:00:00'),
(3,-2,'borrow',9,'2026-09-14 08:00:00'),
(4,2,'lend',9,'2026-09-14 08:00:00');
INSERT INTO needs (id, user_id, title, phenomenon_id, size, start_date, end_date, neighbourhood, note) VALUES
(1,1,'Fan heater',2,'medium','2026-12-01','2026-12-05','Hottingen','Old building, my room gets very cold.'),
(2,2,'Rubber boots size 40',3,'small','2026-10-27','2026-10-28','Wiedikon','Short notice is fine.'),
(3,3,'Electric blanket',2,'medium','2026-12-01','2026-12-15','Altstetten',NULL),
(4,4,'Sandbags, set of 10',4,'medium','2026-10-30','2026-10-30','Seebach','Ground-floor flat near the river.'),
(5,3,'LED lanterns',7,'small','2026-11-18','2026-11-19','Wiedikon',NULL),
(6,6,'Floor fan',1,'medium','2027-06-15','2027-06-17','Enge','For the next heat wave.');
