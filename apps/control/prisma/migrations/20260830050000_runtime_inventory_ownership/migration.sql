ALTER TABLE "tasklattice"."agents"
  ADD COLUMN "created_by_user_id" TEXT;

ALTER TABLE "tasklattice"."agents"
  ADD CONSTRAINT "agents_creator_membership_fkey"
  FOREIGN KEY ("project_id", "created_by_user_id")
  REFERENCES "tasklattice"."project_members"("project_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "agents_project_creator_idx"
  ON "tasklattice"."agents"("project_id", "created_by_user_id");
