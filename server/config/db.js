import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const connectDB = async()=>{
    await mongoose.connect(process.env.MONGO_URL)
    .then(()=> {
        console.log("Database connected successfully")
    }).catch(
    (error)=>{
        console.error('database connection failed',error.message)
        process.exit(1)
    }
    )
}

export default  connectDB 