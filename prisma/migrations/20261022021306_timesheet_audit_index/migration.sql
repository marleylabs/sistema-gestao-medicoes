-- CreateIndex
CREATE INDEX "idx_admin_audit_logs_target" ON "admin_audit_logs"("target_type", "target_id", "created_at" DESC);
