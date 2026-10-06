CREATE TABLE `meeting_insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`meetingId` int NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`transcript` text NOT NULL,
	`summary` text NOT NULL,
	`decisionsJson` text NOT NULL,
	`actionItemsJson` text NOT NULL,
	`language` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meeting_insights_id` PRIMARY KEY(`id`),
	CONSTRAINT `meeting_insights_owner_meeting_unique` UNIQUE(`ownerOpenId`,`meetingId`)
);
--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerOpenId` varchar(64),
	`name` varchar(100) NOT NULL,
	`email` varchar(320) NOT NULL,
	`category` varchar(64) NOT NULL,
	`message` text NOT NULL,
	`status` enum('open','resolved') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `support_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `support_tickets_owner_created_at_idx` ON `support_tickets` (`ownerOpenId`,`createdAt`);