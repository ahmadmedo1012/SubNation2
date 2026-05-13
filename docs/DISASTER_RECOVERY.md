# Disaster Recovery Plan

## Overview

This document outlines the disaster recovery procedures for the SubNation2 application deployed on Render.

## Recovery Time Objectives (RTO)

- **Critical Systems (Auth, Orders):** 4 hours
- **Non-Critical Systems (Analytics, Reports):** 24 hours

## Recovery Point Objectives (RPO)

- **Database:** 15 minutes (automated backups)
- **Application Code:** Real-time (git repository)
- **Static Assets:** Real-time (CDN cache)

## Backup Strategy

### Database Backups

- **Automated:** Render PostgreSQL automatic backups (daily)
- **Manual:** Weekly manual snapshots before major deployments
- **Retention:** 30 days for automated backups, 90 days for manual snapshots

### Code Backups

- **Git Repository:** GitHub with protected main branch
- **Branch Protection:** Requires PR approval and CI checks
- **Tags:** Version tags for each production deployment

### Configuration Backups

- **Environment Variables:** Stored in Render dashboard
- **Render Configuration:** `render.yaml` in repository
- **Secrets:** Managed by Render (never committed to git)

## Recovery Procedures

### Scenario 1: Database Corruption

1. Identify the last healthy backup from Render dashboard
2. Create a new database instance from backup
3. Update `DATABASE_URL` environment variable
4. Deploy application with new database connection
5. Verify data integrity with smoke tests

### Scenario 2: Application Deployment Failure

1. Rollback to previous stable version using Render rollback feature
2. Investigate deployment logs for root cause
3. Fix issue in feature branch
4. Run full CI/CD pipeline
5. Deploy to staging first, then production

### Scenario 3: Region Outage

1. Monitor Render status page for outage information
2. If Render is down, enable read-only mode if possible
3. Communicate with users via status page
4. Prepare to deploy to alternative region if needed
5. Document incident and recovery steps

### Scenario 4: Security Breach

1. Immediately rotate all secrets (SESSION_SECRET, ENCRYPTION_KEY, API keys)
2. Revoke all active user sessions
3. Force password reset for all users
4. Review audit logs for unauthorized access
5. Patch vulnerabilities before bringing systems back online

## Emergency Contacts

- **Primary DevOps:** [Contact]
- **Database Administrator:** [Contact]
- **Security Team:** [Contact]
- **Management:** [Contact]

## Testing Recovery Procedures

- **Monthly:** Test database restore from backup
- **Quarterly:** Full disaster recovery drill
- **After Major Changes:** Test rollback procedures

## Documentation Updates

- Update this plan after any major infrastructure changes
- Document lessons learned from incidents
- Review and update quarterly
