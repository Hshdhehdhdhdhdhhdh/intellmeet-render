CREATE TABLE `meetings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL,
	`scheduledAt` timestamp NOT NULL,
	`durationMinutes` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meetings_id` PRIMARY KEY(`id`)
);
