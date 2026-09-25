import UserModel from '#sql/UserModel'
import engine from '#sync/engine'
import pg from '#util/pg'
import { uuidv7 } from '#util/uuid'
import { colorForEmail } from '#util/color'
import { monthKey } from '#util/time'

/**
 * POST /api/admin/restore — owner-only, one-shot restore of a WHOLE-FAMILY
 * backup (frontend's db/backup.ts exportFamilyBackup(), `version:
 * "family-1"`) onto this server. Exists specifically to remove the
 * limitation every normal per-record write endpoint has on purpose:
 * sync/engine.js's create() always stamps `owner_id = req.user.id`, so
 * there's normally no way for one person to write records attributed to
 * someone else — correct for everyday use, but exactly what a full family
 * migration needs undone, once. That's why this lives under `/admin`
 * (`requireAdmin`-gated) and why it calls engine.rawUpsert directly (the
 * raw write: an explicit owner id, no entity hooks, no stripping of
 * server-only fields like participantIds) instead of relaxing any of the
 * normal endpoints. It still keeps the owner guard — see restoreRow below.
 *
 * Every id already in the payload — accounts/categories/transactions/
 * templates/budgets/receipts/tags — is preserved as-is. They're globally-unique
 * UUIDs minted by the OLD server/clients, and this only ever runs onto a
 * family with none of them yet, so nothing collides and every
 * cross-reference between them (a transaction's accountId/categoryId/
 * templateId/receiptId, a category's parentId, ...) keeps working
 * unmodified. The one thing that CAN'T be preserved is user ids — every
 * backend mints its own (see middleware/auth.js's bootstrap/pre-provision
 * paths) — so `ownerId`/`participantIds` are remapped through a fresh
 * old-id -> new-id table built from `payload.users`, matched by email
 * (case-insensitively) against the requester's own account and whatever
 * this server already has provisioned. Anyone left over is pre-provisioned
 * right here (same shape as POST /api/admin/users, just inline) so their
 * historical data has someone valid to belong to before they've ever
 * actually signed in themselves.
 *
 * Runs inside one DB transaction (see util/pg.js's `transaction`) — a
 * failure partway through (a malformed row, a database error) rolls back
 * everything rather than leaving the family half-restored.
 */
const restoreFamilyBackup = async (req) => {
  const payload = req.body
  if (!payload || payload.version !== 'family-1' || !Array.isArray(payload.users)) {
    const error = new Error('Очікується файл повного бекапу сім’ї (version: "family-1")')
    error.status = 400
    throw error
  }

  return pg.transaction(async () => {
    const idMap = new Map()
    let usersCreated = 0

    for (const u of payload.users) {
      if (!u?.id || !u?.email) continue
      const email = String(u.email).trim().toLowerCase()
      if (email === req.user.email.trim().toLowerCase()) {
        idMap.set(u.id, req.user.id)
        continue
      }
      const existing = await UserModel.getByEmail({ email })
      if (existing) {
        idMap.set(u.id, existing.id)
        continue
      }
      const created = await UserModel.create({
        id: uuidv7(),
        email,
        displayName: u.displayName || email,
        photoUrl: null,
        color: colorForEmail(email),
        role: u.role === 'owner' ? 'owner' : 'member',
        isActive: u.isActive !== false,
      })
      idMap.set(u.id, created.id)
      usersCreated += 1
    }

    // Any owner id not found above (payload.users incomplete, or a row
    // whose original owner was never a real family member to begin with)
    // falls back to whoever's running this restore, rather than aborting
    // the whole thing over one bad reference.
    const mapOwner = (oldId) => idMap.get(oldId) ?? req.user.id

    // rawUpsert still honours the upsert's guard: a row whose id this server
    // already has under a DIFFERENT owner, or has already deleted, comes back
    // as null instead of being overwritten or resurrected. That's never
    // supposed to happen on the fresh family this runs onto, so it aborts
    // (and rolls back) the whole restore rather than silently leaving that
    // row out.
    const restoreRow = async (row) => {
      if (await engine.rawUpsert(row)) return
      const error = new Error(
        `Запис ${row.entity}/${row.id} уже є на цьому сервері (належить іншому користувачу або видалений)`,
      )
      error.status = 409
      throw error
    }

    for (const a of payload.accounts ?? []) {
      await restoreRow({
        entity: 'accounts',
        id: a.id,
        ownerId: mapOwner(a.ownerId),
        body: {
          name: a.name,
          type: a.type,
          currency: a.currency,
          icon: a.icon,
          color: a.color,
          initialBalance: a.initialBalance,
          loanDirection: a.loanDirection ?? null,
          includeInTotal: a.includeInTotal,
          archived: a.archived,
          order: a.order,
          note: a.note ?? null,
          currencyDisplay: a.currencyDisplay ?? null,
        },
      })
    }

    // Categories can reference each other via parentId — insert in
    // dependency order (parent before child) so that FK never fails; a
    // dangling/cyclic parentId (shouldn't happen in a well-formed export)
    // falls back to top-level rather than looping forever or aborting the
    // whole restore over one bad row.
    const categories = payload.categories ?? []
    const categoryIds = new Set(categories.map((c) => c.id))
    const insertedCategoryIds = new Set()
    let remainingCategories = [...categories]
    while (remainingCategories.length) {
      const ready = remainingCategories.filter(
        (c) => !c.parentId || !categoryIds.has(c.parentId) || insertedCategoryIds.has(c.parentId),
      )
      const batch = ready.length ? ready : remainingCategories
      for (const c of batch) {
        await restoreRow({
          entity: 'categories',
          id: c.id,
          ownerId: mapOwner(c.ownerId),
          body: {
            name: c.name,
            kind: c.kind,
            icon: c.icon,
            color: c.color,
            parentId: c.parentId && categoryIds.has(c.parentId) ? c.parentId : null,
            archived: c.archived,
            order: c.order,
            isDefault: c.isDefault ?? false,
            currency: c.currency ?? null,
            currencyDisplay: c.currencyDisplay ?? null,
          },
        })
        insertedCategoryIds.add(c.id)
      }
      const batchIds = new Set(batch.map((c) => c.id))
      remainingCategories = remainingCategories.filter((c) => !batchIds.has(c.id))
    }

    // Templates and receipts both need to exist before transactions (which
    // can reference either via templateId/receiptId) — neither depends on
    // the other, so either order between these two is fine.
    for (const tpl of payload.templates ?? []) {
      await restoreRow({
        entity: 'recurringTemplates',
        id: tpl.id,
        ownerId: mapOwner(tpl.ownerId),
        body: {
          type: tpl.type,
          accountId: tpl.accountId,
          toAccountId: tpl.toAccountId ?? null,
          categoryId: tpl.categoryId ?? null,
          subcategoryId: tpl.subcategoryId ?? null,
          amount: tpl.amount,
          currency: tpl.currency,
          note: tpl.note ?? null,
          frequency: tpl.frequency,
          interval: tpl.interval,
          startDate: tpl.startDate,
          endDate: tpl.endDate,
          nextDate: tpl.nextDate,
          active: tpl.active,
        },
      })
    }

    for (const r of payload.receipts ?? []) {
      await restoreRow({
        entity: 'receipts',
        id: r.id,
        ownerId: mapOwner(r.ownerId),
        body: {
          merchant: r.merchant ?? null,
          date: r.date,
          currency: r.currency ?? null,
          note: r.note ?? null,
          accountId: r.accountId ?? null,
        },
      })
    }

    // Tags are shared across the family like categories, and flat (no
    // parentId), so no ordering among them — only before the transactions
    // whose tagIds point at them.
    for (const tg of payload.tags ?? []) {
      await restoreRow({
        entity: 'tags',
        id: tg.id,
        ownerId: mapOwner(tg.ownerId),
        body: { name: tg.name, color: tg.color, archived: tg.archived ?? false },
      })
    }

    for (const tx of payload.transactions ?? []) {
      await restoreRow({
        entity: 'transactions',
        id: tx.id,
        ownerId: mapOwner(tx.ownerId),
        body: {
          // [ownerId], or [ownerId, counterpartyId] for a cross-profile
          // transfer (see frontend's Transaction.participantIds) — every
          // entry is itself a user id from the OLD family, so it needs the
          // exact same remap as ownerId, not a pass-through.
          participantIds: (tx.participantIds ?? []).map(mapOwner),
          type: tx.type,
          date: tx.date,
          accountId: tx.accountId,
          toAccountId: tx.toAccountId ?? null,
          categoryId: tx.categoryId ?? null,
          subcategoryId: tx.subcategoryId ?? null,
          amount: tx.amount,
          toAmount: tx.toAmount ?? null,
          currency: tx.currency,
          note: tx.note ?? null,
          templateId: tx.templateId ?? null,
          receiptId: tx.receiptId ?? null,
          tagIds: tx.tagIds ?? [],
        },
      })
    }

    for (const b of payload.budgets ?? []) {
      await restoreRow({
        entity: 'budgets',
        id: b.id,
        ownerId: mapOwner(b.ownerId),
        body: {
          categoryId: b.categoryId,
          amount: b.amount,
          currency: b.currency,
          period: b.period,
          // A backup exported before Budget.month existed has no month of its
          // own — fall back to the month it was created in, same rule the
          // add-budget-month migration applied to rows already in the database.
          month: b.month ?? monthKey(b.createdAt),
        },
      })
    }

    return {
      usersCreated,
      accounts: (payload.accounts ?? []).length,
      categories: categories.length,
      templates: (payload.templates ?? []).length,
      transactions: (payload.transactions ?? []).length,
      budgets: (payload.budgets ?? []).length,
      receipts: (payload.receipts ?? []).length,
      tags: (payload.tags ?? []).length,
    }
  })
}

export default restoreFamilyBackup
