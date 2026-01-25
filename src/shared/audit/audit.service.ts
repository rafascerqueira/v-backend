import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'

export type AuditAction = 
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_RESET'
  | 'STATUS_CHANGE'

export interface AuditLogData {
  action: AuditAction
  entity: string
  entityId?: string | number
  userId?: string
  oldValue?: Record<string, unknown>
  newValue?: Record<string, unknown>
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(data: AuditLogData): Promise<void> {
    try {
      await this.prisma.audit_log.create({
        data: {
          action: data.action,
          entity: data.entity,
          entity_id: data.entityId?.toString(),
          user_id: data.userId,
          old_value: data.oldValue as any,
          new_value: data.newValue as any,
          metadata: data.metadata as any,
          ip_address: data.ipAddress,
          user_agent: data.userAgent,
        },
      })
    } catch (error) {
      console.error('[AUDIT] Failed to create audit log:', error)
    }
  }

  async getByEntity(entity: string, entityId: string, limit = 50) {
    return this.prisma.audit_log.findMany({
      where: { entity, entity_id: entityId },
      orderBy: { created_at: 'desc' },
      take: limit,
    })
  }

  async getByUser(userId: string, limit = 50) {
    return this.prisma.audit_log.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    })
  }

  async getRecent(limit = 100) {
    return this.prisma.audit_log.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
    })
  }
}
