// Drizzle tables = SPEC-001 §Data Model. Column names snake_case, TS fields camelCase.
// `users.email` is COLLATE NOCASE in the SPEC DDL; drizzle's sqlite column builder cannot
// express a collation, so it is added by hand in drizzle/0000_init.sql (see TASK-001 notes).
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("USER"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("users_role_check", sql`${t.role} IN ('USER','ADMIN')`)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey(),
    kind: text("kind").notNull(),
    nameTh: text("name_th").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [check("categories_kind_check", sql`${t.kind} IN ('IN_GAME','PHYSICAL')`)],
);

export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    feeRatePercent: integer("fee_rate_percent").notNull().default(20),
    feeMinimum: integer("fee_minimum").notNull().default(20),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    status: text("status").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    description: text("description").notNull(),
    priceMode: text("price_mode").notNull(),
    feePayer: text("fee_payer").notNull(),
    enteredPrice: integer("entered_price").notNull(),
    basePrice: integer("base_price").notNull(),
    fee: integer("fee").notNull(),
    buyerPays: integer("buyer_pays").notNull(),
    sellerReceives: integer("seller_receives").notNull(),
    feeRatePercent: integer("fee_rate_percent").notNull(),
    feeMinimum: integer("fee_minimum").notNull(),
    openedByRole: text("opened_by_role").notNull(),
    buyerId: text("buyer_id").references(() => users.id),
    sellerId: text("seller_id").references(() => users.id),
    slipFileId: text("slip_file_id"),
    rejectReason: text("reject_reason"),
    paymentConfirmedAt: text("payment_confirmed_at"),
    courier: text("courier"),
    trackingNumber: text("tracking_number"),
    deliveredAt: text("delivered_at"),
    parcelArrivedAt: text("parcel_arrived_at"),
    autoReleaseAt: text("auto_release_at"),
    releasedAt: text("released_at"),
    releasedBy: text("released_by"),
    paidOutAt: text("paid_out_at"),
    completedAt: text("completed_at"),
    cancelledAt: text("cancelled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("rooms_price_mode_check", sql`${t.priceMode} IN ('FEE_ADDED','FEE_INCLUDED')`),
    check("rooms_fee_payer_check", sql`${t.feePayer} IN ('SELLER','BUYER','SPLIT')`),
    check("rooms_opened_by_role_check", sql`${t.openedByRole} IN ('BUYER','SELLER')`),
    check("rooms_released_by_check", sql`${t.releasedBy} IN ('BUYER','SYSTEM')`),
    index("rooms_status_auto_release").on(t.status, t.autoReleaseAt),
    index("rooms_buyer").on(t.buyerId),
    index("rooms_seller").on(t.sellerId),
  ],
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    kind: text("kind").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("files_kind_check", sql`${t.kind} IN ('SLIP','EVIDENCE')`),
    index("files_room").on(t.roomId, t.kind),
  ],
);

export const roomEvents = sqliteTable(
  "room_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id),
    type: text("type").notNull(),
    actorRole: text("actor_role").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("room_events_actor_role_check", sql`${t.actorRole} IN ('BUYER','SELLER','ADMIN','SYSTEM')`),
    index("room_events_room").on(t.roomId, t.createdAt),
  ],
);
