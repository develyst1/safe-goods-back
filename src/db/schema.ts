// Drizzle tables = SPEC-002 §Data Model (PostgreSQL). Column names snake_case, TS fields camelCase.
// Timestamps are `timestamptz` read as Date; the serializers render ISO-8601 UTC strings.
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("USER"),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    check("users_role_check", sql`${t.role} IN ('USER','ADMIN')`),
    // AC-4: case-insensitive uniqueness without citext (SPEC-002 §Email case)
    uniqueIndex("users_email_lower").on(sql`lower(${t.email})`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: integer("id").primaryKey(),
    kind: text("kind").notNull(),
    nameTh: text("name_th").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [check("categories_kind_check", sql`${t.kind} IN ('IN_GAME','PHYSICAL')`)],
);

export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    feeRatePercent: integer("fee_rate_percent").notNull().default(20),
    feeMinimum: integer("fee_minimum").notNull().default(20),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey(),
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
    buyerId: uuid("buyer_id").references(() => users.id),
    sellerId: uuid("seller_id").references(() => users.id),
    slipFileId: uuid("slip_file_id"),
    rejectReason: text("reject_reason"),
    paymentConfirmedAt: tz("payment_confirmed_at"),
    courier: text("courier"),
    trackingNumber: text("tracking_number"),
    deliveredAt: tz("delivered_at"),
    parcelArrivedAt: tz("parcel_arrived_at"),
    autoReleaseAt: tz("auto_release_at"),
    releasedAt: tz("released_at"),
    releasedBy: text("released_by"),
    paidOutAt: tz("paid_out_at"),
    completedAt: tz("completed_at"),
    cancelledAt: tz("cancelled_at"),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
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

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    kind: text("kind").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    check("files_kind_check", sql`${t.kind} IN ('SLIP','EVIDENCE')`),
    index("files_room").on(t.roomId, t.kind),
  ],
);

export const roomEvents = pgTable(
  "room_events",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    type: text("type").notNull(),
    actorRole: text("actor_role").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    note: text("note"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    check("room_events_actor_role_check", sql`${t.actorRole} IN ('BUYER','SELLER','ADMIN','SYSTEM')`),
    index("room_events_room").on(t.roomId, t.createdAt),
  ],
);
