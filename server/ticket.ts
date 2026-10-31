import { Schema, type Connection, type InferSchemaType } from 'mongoose';

export const STATUSES = ['open', 'in_progress', 'resolved'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;

const ticketSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 140 },
  description: { type: String, trim: true, maxlength: 3000, default: '' },
  status: { type: String, enum: STATUSES, default: 'open', required: true },
  priority: { type: String, enum: PRIORITIES, default: 'medium', required: true },
  tags: {
    type: [{ type: String, trim: true, lowercase: true, minlength: 1, maxlength: 32 }],
    default: [],
    validate: [
      { validator: (tags: string[]) => tags.length <= 8, message: 'Use at most 8 tags.' },
      { validator: (tags: string[]) => new Set(tags).size === tags.length, message: 'Tags must be unique.' },
    ],
  },
}, { timestamps: true, versionKey: false, strict: 'throw' });

// Equality fields precede the descending sort, so every supported filter has an index.
ticketSchema.index({ createdAt: -1, _id: -1 }, { name: 'tickets_newest' });
ticketSchema.index({ status: 1, createdAt: -1, _id: -1 }, { name: 'tickets_status_newest' });
ticketSchema.index({ priority: 1, createdAt: -1, _id: -1 }, { name: 'tickets_priority_newest' });
ticketSchema.index({ status: 1, priority: 1, createdAt: -1, _id: -1 }, { name: 'tickets_status_priority_newest' });

export type Ticket = InferSchemaType<typeof ticketSchema>;

export function getTicketModel(connection: Connection) {
  return connection.model<Ticket>('Ticket', ticketSchema);
}
