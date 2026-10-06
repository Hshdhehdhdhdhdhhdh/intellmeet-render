CREATE TABLE `meeting_invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`meetingId` int NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `meeting_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `meeting_invitations_meeting_email_unique` UNIQUE(`meetingId`,`email`)
);
--> statement-breakpoint
CREATE INDEX `meeting_invitations_email_idx` ON `meeting_invitations` (`email`);