import { NextRequest } from 'next/server'
import { Action, CompletedAction, ActionGetResponse, ActionPostRequest, ActionPostResponse, ActionError, ACTIONS_CORS_HEADERS, createPostResponse, MEMO_PROGRAM_ID } from "@solana/actions"
import { Transaction, TransactionInstruction, PublicKey, ComputeBudgetProgram, Connection, clusterApiUrl, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js"
import {
  NATIVE_MINT,
  createSyncNativeInstruction,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createCloseAccountInstruction,
  createTransferInstruction,
  createBurnInstruction
} from "@solana/spl-token"
import Irfan from '@/models/irfan'
import { connectToDB } from '@/utils/database'
import { GoogleAuth, IdTokenClient } from 'google-auth-library'

const FASTAPI_URL = ""

const ACTION_URL = "https://blinkman.sendarcade.fun/api/actions/blinkman"

const MAIL_URL = ""

const ADDRESS = new PublicKey("AYAQ3NJjVn4a7izGFgHh1EAN2FW8WU8akKuwkh2wM6f")

const SENDCOIN_MINT_ADDRESS = new PublicKey("SENDdRQtYMWaQrBroBrJ2Q53fgVuq95CV9UPGEvpCxa")

const PRICE_PER_CLICK_LAMPORTS = 990000

async function getIdentityToken(targetAudience: string): Promise<string> {
  const auth = new GoogleAuth()
  const client = await auth.getIdTokenClient(targetAudience)
  const idTokenClient = client as IdTokenClient

  // The token is automatically refreshed by the client as needed
  const tokenResponse = await idTokenClient.getRequestHeaders()
  const identityToken = tokenResponse.Authorization?.split(' ')[1]

  if (!identityToken) {
    throw new Error('Failed to retrieve identity token.')
  }

  return identityToken
}

export const GET = async (req: NextRequest) => {
  await connectToDB()

  try {
    const countDrownAndSave = await Irfan.aggregate([
      {
        $group: {
          _id: "$save_or_drown",
          count: { $sum: 1 }
        }
      }
    ])
    
    // Initialize counts to zero in case one of the values is missing
    let saveCount = 0
    let drownCount = 0

    // Iterate through the aggregation result to extract the counts
    countDrownAndSave.forEach(item => {
      if (item._id === 'save') {
        saveCount = item.count
      } else if (item._id === 'drown') {
        drownCount = item.count
      }
    })

    console.log(`Saves: ${saveCount}, Drowns: ${drownCount}`)

    const net = saveCount - drownCount
    console.log("Net: ", net)

    const constrainedNet = Math.max(-500, Math.min(net, 500))
    console.log("Constrained Net: ", constrainedNet)

    const FastApiIdentityToken = await getIdentityToken(FASTAPI_URL)

    const imageResponse = await fetch(`${FASTAPI_URL}/board?irfan=${constrainedNet}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FastApiIdentityToken}`
      }
    })
    const imageResponseData = await imageResponse.json()
    console.log("Image Response Data: ", imageResponseData)
    const image = imageResponseData.url
    console.log("Image: ", image)

    const payload: ActionGetResponse = {
      type: "action",
      icon: image,
      title: `Save the Blink Man!`,
      label: '',
      description: `\nGo smash the ‘Save or Drown’ button and watch Blink Man aka Irfan rise or sink in the image with every tap!`,
      links: {
        actions: [
          {
            type: 'post',
            href: `${ACTION_URL}?save_or_drown=save`,
            label: `Save [votes: ${saveCount}]`
          },
          {
            type: 'post',
            href: `${ACTION_URL}?save_or_drown=drown`,
            label: `Drown [votes: ${drownCount}]`
          }
        ]
      }
    }

    return Response.json(payload, {
      headers: ACTIONS_CORS_HEADERS
    })

  } catch (error) {
    console.error('Failed, fuck: ', error)
  }
}

export const OPTIONS = GET

function mapAndRoundUp(
  value: number,
  fromRange: [number, number],
  toRange: [number, number]
): number {
  // Destructure the ranges for easier access
  const [fromMin, fromMax] = fromRange;
  const [toMin, toMax] = toRange;

  // Apply the linear mapping formula
  const mappedValue = ((value - fromMin) * (toMax - toMin)) / (fromMax - fromMin) + toMin;

  // Round the result up to the nearest integer
  return Math.ceil(mappedValue);
}

export const POST = async (req: NextRequest) => {
  await connectToDB()

  try {
    const body: any = await req.json()
    console.log("Body: ", body)

    let account: PublicKey

    try { 
      account = new PublicKey(body.account)
    } catch (err) {
      return new Response('Invalid account provided', {
        status: 400,
        headers: ACTIONS_CORS_HEADERS
      })
    }

    const save_or_drown = req.nextUrl.searchParams.get('save_or_drown')
    console.log("Save or drown? ", save_or_drown)

    if (save_or_drown !== "save" && save_or_drown !== "drown") {
      return new Response('You either have to save or drown the blink man, no 3rd option.', {
        status: 400,
        headers: ACTIONS_CORS_HEADERS
      })
    }

    const isNext = req.nextUrl.searchParams.get('next')
    console.log("Is Next? ", isNext)

    if (isNext === 'yes') {
      console.log("Body: ", body)
      if (body.signature) {

        // Check if the signature already exists in the database
        const existingSignature = await Irfan.findOne({ signature: body.signature })
        if (existingSignature) {
          const mailIdentityToken = await getIdentityToken(MAIL_URL)

          const mailResponse = await fetch(`${MAIL_URL}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${mailIdentityToken}`
            },
            body: JSON.stringify({ subject: 'blinkman hackur tringgg to attempt signature duplicacy', text: `zone: isNext === yes\nAddress: ${account.toBase58()}\nSignature: ${body.signature}` })
          })
          const mailResponseData = await mailResponse.json()
          const { success } = mailResponseData
          console.log('Mail sent:', success)

          throw new Error("Signature already fucking exists!")
        }

        let moveNumber = 1

        const latestIrfan = await Irfan.findOne().sort({ timestamp: -1 })

        console.log(`Latest State: ${latestIrfan}`)

        if (latestIrfan) {
          moveNumber = latestIrfan.moveNumber + 1
        }

        const irfan = new Irfan({
          address: account.toBase58(),
          moveNumber,
          save_or_drown,
          priceLamports: PRICE_PER_CLICK_LAMPORTS,
          signature: body.signature
        })

        await irfan.save()

        const countDrownAndSave = await Irfan.aggregate([
          {
            $group: {
              _id: "$save_or_drown",
              count: { $sum: 1 }
            }
          }
        ]);

        // Initialize counts to zero in case one of the values is missing
        let saveCount = 0
        let drownCount = 0

        // Iterate through the aggregation result to extract the counts
        countDrownAndSave.forEach(item => {
          if (item._id === 'save') {
            saveCount = item.count
          } else if (item._id === 'drown') {
            drownCount = item.count
          }
        })

        console.log(`Saves: ${saveCount}, Drowns: ${drownCount}`)

        const net = saveCount - drownCount
        console.log("Net: ", net)

        const constrainedNet = Math.max(-500, Math.min(net, 500))
        console.log("Constrained Net: ", constrainedNet)

        // const fromRange: [number, number] = [-1000, 1000]
        // const toRange: [number, number] = [-50, 50]

        // const mappedValue = mapAndRoundUp(net, fromRange, toRange)

        // let chaining_net = mappedValue

        // if (save_or_drown === "save") {
        //   chaining_net = chaining_net + 1
        // } else if (save_or_drown === "drown") {
        //   chaining_net = chaining_net - 1
        // }

        // console.log("Chaining Net: ", chaining_net)

        const FastApiIdentityToken = await getIdentityToken(FASTAPI_URL)

        const imageResponse = await fetch(`${FASTAPI_URL}/board?irfan=${constrainedNet}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${FastApiIdentityToken}`
          }
        })
        const imageResponseData = await imageResponse.json()
        const image = imageResponseData.url
        console.log("Image: ", image)

        const payload: Action = {
          type: "action",
          icon: image,
          title: `Save the Blink Man!`,
          label: '',
          description: `\nGo smash the ‘Save or Drown’ button and watch Blink Man aka Irfan rise or sink in the image with every tap!`,
          links: {
            actions: [
              {
                type: 'post',
                href: `${ACTION_URL}?save_or_drown=save`,
                label: `Save [votes: ${saveCount}]`
              },
              {
                type: 'post',
                href: `${ACTION_URL}?save_or_drown=drown`,
                label: `Drown [votes: ${drownCount}]`
              }
            ]
          }
        }

        return Response.json(payload, { headers: ACTIONS_CORS_HEADERS })

      } else {
        console.log("No FUCKIN signature found!")
      }
    }

    const connection = new Connection(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`)
    const transaction = new Transaction()

    const quoteResponse = await (
      await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112\
&outputMint=SENDdRQtYMWaQrBroBrJ2Q53fgVuq95CV9UPGEvpCxa\
&amount=${PRICE_PER_CLICK_LAMPORTS}\
&slippageBps=100`)
    ).json()

    console.log({ quoteResponse })

    const outAmountThreshold = quoteResponse.otherAmountThreshold

    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 300_000 * 1
      }),
      new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ID),
        data: Buffer.from(`${save_or_drown}`, "utf-8"),
        keys: []
      })
    )

    const ATA_WSOL = await getAssociatedTokenAddress(NATIVE_MINT, account)
    console.log("Wrapped SOL ATA: ", ATA_WSOL.toBase58())

    const ATA_SEND = await getAssociatedTokenAddress(SENDCOIN_MINT_ADDRESS, account)
    console.log("Send ATA: ", ATA_SEND.toBase58())

    const WSOL_Info = await connection.getAccountInfo(ATA_WSOL)
    const SEND_Info = await connection.getAccountInfo(ATA_SEND)

    if (!WSOL_Info) {
      console.log(`Wrapped SOL ATA doesn't exist. Creating one now...`)
      const ATAIx = createAssociatedTokenAccountInstruction(
        account,
        ATA_WSOL,
        account,
        NATIVE_MINT
      )
      transaction.add(ATAIx)
    }

    if (!SEND_Info) {
      console.log(`Send ATA doesn't exist. Creating one now...`)
      const ATAIx = createAssociatedTokenAccountInstruction(
        account,
        ATA_SEND,
        account,
        SENDCOIN_MINT_ADDRESS
      )
      transaction.add(ATAIx)
    }

    // Get serialized transactions for the swap
    const instructions = await (
      await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: account.toString(),
          dynamicComputeUnitLimit: true
        })
      })
    ).json()

    if (instructions.error) {
      throw new Error("Failed to get swap instructions: " + instructions.error)
    }

    const { swapInstruction: swapInstructionPayload } = instructions

    const deserializeInstruction = (instruction: any) => {
      return new TransactionInstruction({
        programId: new PublicKey(instruction.programId),
        keys: instruction.accounts.map((key: any) => ({
          pubkey: new PublicKey(key.pubkey),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
        data: Buffer.from(instruction.data, "base64"),
      })
    }

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: ATA_WSOL,
        lamports: PRICE_PER_CLICK_LAMPORTS,
      }),
      createSyncNativeInstruction(ATA_WSOL),
      deserializeInstruction(swapInstructionPayload)
    )

    if (!WSOL_Info) {
      transaction.add(
        createCloseAccountInstruction(
          ATA_WSOL,
          account,
          account
        )
      )
    }

    const ADMIN_SEND_ATA = await getAssociatedTokenAddress( SENDCOIN_MINT_ADDRESS, ADDRESS )

    const ADMIN_SEND_Info = await connection.getAccountInfo(ADMIN_SEND_ATA)

    if (!ADMIN_SEND_Info) {
      console.log(`Send ATA for ADMIN doesn't exist. Creating one now...`)
      const ATAIx = createAssociatedTokenAccountInstruction(
        account,
        ADMIN_SEND_ATA,
        ADDRESS,
        SENDCOIN_MINT_ADDRESS
      )
      transaction.add(ATAIx)
    }

    const transferAmount = Math.floor(outAmountThreshold * 0.20) // Ensure it's an integer if required

    transaction.add(
      createTransferInstruction(
        ATA_SEND,
        ADMIN_SEND_ATA,
        account,
        transferAmount
      )
    )

    transaction.feePayer = account
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        type: 'transaction',
        transaction,
        message: `${save_or_drown}`,
        links: {
          next: {
            type: 'post',
            href: `${ACTION_URL}?next=yes&save_or_drown=${save_or_drown}`,
          }
        }
      }
    })

    return Response.json(payload, { headers: ACTIONS_CORS_HEADERS })

  } catch (err) {
    console.error(err)
    return Response.json("An unknown error occured", { status: 500 })
  }
}
