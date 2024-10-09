import { Schema, model, models } from 'mongoose'

const IrfanSchema = new Schema({
  address: {
    type: String,
    required: [true, 'Address is required'],
    immutable: true
  },
  moveNumber: {
    type: Number,
    required: [true, 'Move number is required'],
    immutable: true
  },
  save_or_drown: {
    type: String,
    enum: ['save', 'drown'],
    immutable: true
  },
  priceLamports: {
    type: Number,
    required: [true, 'Price in lamports is required'],
    immutable: true
  },
  signature: {
    type: String,
    required: [true, 'Signature is required'],
    immutable: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    immutable: true
  }
})

const Irfan = models.Irfan || model('Irfan', IrfanSchema)

export default Irfan
