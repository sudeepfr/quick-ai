
import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import pdf from 'pdf-parse/lib/pdf-parse.js'
const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

const GEMINI_TEXT_MODEL = "gemini-3.5-flash";

const getAiErrorMessage = (error) => {
    const providerMessage =
        error?.response?.data?.error?.message ||
        error?.error?.message ||
        error?.message;

    if (error?.status === 429 || error?.response?.status === 429) {
        if (!providerMessage || providerMessage.toLowerCase().includes('no body')) {
            return "Gemini rate limit or quota reached. Please wait and try again, or check your Gemini API key quota/billing in Google AI Studio.";
        }

        return providerMessage;
    }

    if (error?.status === 404 || error?.response?.status === 404) {
        if (!providerMessage || providerMessage.toLowerCase().includes('no body')) {
            return `Gemini model or endpoint was not found. Check that your API key can access ${GEMINI_TEXT_MODEL}.`;
        }

        return providerMessage;
    }

    return providerMessage || "AI text generation failed. Please try again.";
}

const handleAiError = (res, error) => {
    const status = error?.status || error?.response?.status || 500;
    const message = getAiErrorMessage(error);

    console.error('AI provider error:', {
        status,
        message,
        providerMessage: error?.message,
        type: error?.error?.type,
        code: error?.error?.code,
    });

    return res.status(status).json({ success: false, message });
}



// For generating the article according to length
const generateArticle = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt, length } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({ success: false, message: "Limit reached. Upgrade to continue..." });

        }

        const response = await AI.chat.completions.create({
            model:"gemini-3.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: length,

        });

        const content = response.choices[0].message.content;

        await sql` INSERT INTO creations (user_id, prompt,content,type ) 
        VALUES (${userId},${prompt},${content},'article')`;

        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: {
                    free_usage: free_usage + 1
                }
            })
        }

        res.json({ success: true, content })

    } catch (e) {
        return handleAiError(res, e);
    }
}


// For generating the blogTitle 
const generateBlogTitle = async (req, res) => {
    try {
        const { userId } = req.auth();
        const { prompt } = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;

        if (plan !== 'premium' && free_usage >= 10) {
            return res.json({ success: false, message: "Limit reached. Upgrade to continue..." });

        }

        const response = await AI.chat.completions.create({
            model: "gemini-3.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: 100,
        });

        const content = response.choices[0].message.content;

        await sql` INSERT INTO creations (user_id, prompt,content,type ) 
        VALUES (${userId},${prompt},${content},'blog-title')`;

        if (plan !== 'premium') {
            await clerkClient.users.updateUserMetadata(userId, {
                privateMetadata: {
                    free_usage: free_usage + 1
                }
            })
        }

        res.json({ success: true, content })

    } catch (e) {
        return handleAiError(res, e);
    }
}


const generateImage = async (req, res) => {
    try {
        const { userId } = await req.auth();
        const { prompt, publish } = req.body;
        const plan = req.plan;
        console.log(plan);

        if (plan !== 'premium') {
            return res.json({ success: false, message: "Limit reached. Upgrade to continue..." });
        }

        const form = new FormData()
        form.append('prompt', prompt);
        const { data } = await axios.post('https://clipdrop-api.co/text-to-image/v1', form, {
            headers: {
                'x-api-key': process.env.CLIPDROP_API_KEY,
            },
            responseType: "arraybuffer",
        })

        const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary').toString('base64')}`
        const { secure_url } = await cloudinary.uploader.upload(base64Image);

        await sql` INSERT INTO creations (user_id, prompt,content,type,publish) 
        VALUES (${userId},${prompt},${secure_url},'image',${publish ?? false})`;

        res.json({ success: true, content: secure_url });


    } catch (e) {
        console.log(e.message);
        res.json({ success: false, message: e.message })
    }
}


const removeImageBackground = async (req, res) => {
    try {
        const { userId } = await req.auth();
        const image = req.file;
        console.log('req.file:', req.file);
        const plan = req.plan;
        console.log(plan);
        if (plan !== 'premium') {
            return res.json({ success: false, message: "Limit reached. Upgrade to continue..." });
        }

        const { secure_url } = await cloudinary.uploader.upload(image.path, {
            transformation: [
                {
                    effect: 'background_removal',
                    background_removal: 'remove_the_background',
                }
            ]
        })


        await sql` INSERT INTO creations (user_id, prompt,content,type) 
        VALUES (${userId},'Remove background from image',${secure_url},'image')`;

        res.json({ success: true, content: secure_url });


    } catch (e) {
        console.log(e.message);
        res.json({ success: false, message: e.message })
    }
}


const removeImageObject = async (req, res) => {
    try {
        const { userId } = await req.auth();
        const { object } = req.body;
        const image  = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.json({ success: false, message: "Limit reached. Upgrade to continue..." });
        }

        const { public_id } = await cloudinary.uploader.upload(image.path);
        console.log("Removing object:", object);
        const imageUrl = cloudinary.url(public_id, {
            transformation: [{
                effect: `gen_remove:${object}`
            }],
            resource_type: 'image'
        })



        await sql` INSERT INTO creations (user_id, prompt,content,type) 
        VALUES (${userId},${`Removed ${object} from image`},${imageUrl},'image')`;

        res.json({ success: true, content: imageUrl });


    } catch (e) {
        console.log(e.message);
        res.json({ success: false, message: e.message })
    }
}


const resumeReview = async (req, res) => {
    try {
        const { userId } = await req.auth();
        const resume = req.file;
        const plan = req.plan;

        if (plan !== 'premium') {
            return res.json({ success: false, message: "Limit reached. Upgrade to continue..." });
        }

        if (resume.size > 5 * 1024 * 1024) {
            return res.json({ success: false, message: "Resume file size exceeds allowed size (5MB)." })
        }

        // parsing the pdf into text fo further opration
        const dataBuffer = fs.readFileSync(resume.path);
        const pdfData = await pdf(dataBuffer);

        const prompt = `Review the following resume and provide constructive feedback on its strengths,weekness,and area for improvment. Resume Content:\n\n${pdfData.text}`

        const response = await AI.chat.completions.create({
            model: "gemini-3.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: 1000,
        });

        const content = response.choices[0].message.content;

        await sql` INSERT INTO creations (user_id, prompt,content,type) 
        VALUES (${userId},'Review the uploaded image',${content},'resume-review')`;

        res.json({ success: true, content });


    } catch (e) {
        return handleAiError(res, e);
    }
}


export { generateArticle, generateBlogTitle, generateImage, removeImageBackground, removeImageObject, resumeReview };
