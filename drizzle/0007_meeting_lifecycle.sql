ALTER TABLE `meetings` ADD `description` text;--> statement-breakpoint
ALTER TABLE `meetings` ADD `status` enum('scheduled','live','completed','cancelled') DEFAULT 'scheduled' NOT NULL;