CREATE TABLE `copilot_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(36) NOT NULL,
	`ownerOpenId` varchar(64),
	`name` varchar(240) NOT NULL,
	`mimeType` varchar(160) NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`size` int NOT NULL,
	`extractedText` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `copilot_files_id` PRIMARY KEY(`id`),
	CONSTRAINT `copilot_files_publicId_unique` UNIQUE(`publicId`)
);
--> statement-breakpoint
CREATE INDEX `copilot_files_owner_created_at_idx` ON `copilot_files` (`ownerOpenId`,`createdAt`);