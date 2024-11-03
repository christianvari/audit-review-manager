import { Octokit } from "@octokit/rest";
import fs from "fs/promises";
import path from "path";
import xlsx from "xlsx";
import dotenv from "dotenv";

dotenv.config();

// Initialize Octokit with authentication
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
});

// Load configuration from a specified path or default to "config.json" in the current directory
async function loadConfig(configPath = "./config.json") {
    try {
        const data = await fs.readFile(configPath, "utf8");
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading config file:", error);
        return [];
    }
}

// Fetch PR review comments with reactions
async function getPRReviewCommentsWithReactions(owner, repo, pullRequestNumber) {
    const rows = []; // Array to hold each comment's data for Excel

    try {
        // Fetch review comments on the specified pull request
        const { data: comments } = await octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pullRequestNumber,
        });

        for (const comment of comments) {
            const { id: commentId, body: commentText } = comment;
            const row = { CommentText: commentText };

            // Fetch reactions for each comment
            const { data: reactions } =
                await octokit.rest.reactions.listForPullRequestReviewComment({
                    owner,
                    repo,
                    comment_id: commentId,
                });

            // Process reactions and add to row
            reactions.forEach((reaction) => {
                const emoji = getEmoji(reaction.content);
                const user = reaction.user.login;

                // Add user and their emoji to the row
                row[user] = emoji;
            });

            rows.push(row);
        }
    } catch (error) {
        console.error(
            `Error fetching review comments or reactions for ${owner}/${repo} - PR #${pullRequestNumber}:`,
            error,
        );
    }

    return rows;
}

// Function to map reaction content to emoji
function getEmoji(content) {
    const emojiMap = {
        "+1": "👍",
        "-1": "👎",
        laugh: "😄",
        hooray: "🎉",
        confused: "😕",
        heart: "❤️",
        rocket: "🚀",
        eyes: "👀",
    };
    return emojiMap[content] || content;
}

// Main function to process each PR from config
async function main(configPath) {
    const config = await loadConfig(configPath);

    if (config.length === 0) {
        console.log("No repositories and pull requests found in config.");
        return;
    }

    const workbook = xlsx.utils.book_new(); // Create a new workbook

    for (const { owner, repo, pullRequestNumber } of config) {
        console.log(`\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`);
        const rows = await getPRReviewCommentsWithReactions(
            owner,
            repo,
            pullRequestNumber,
        );

        // Create a worksheet for this PR and add it to the workbook
        const worksheet = xlsx.utils.json_to_sheet(rows);
        const sheetName = `${repo}-PR#${pullRequestNumber}`;
        xlsx.utils.book_append_sheet(workbook, worksheet, sheetName.substring(0, 31)); // Sheet names are limited to 31 chars
    }

    // Write workbook to file
    xlsx.writeFile(workbook, "Review.xlsx");
    console.log("Review.xlsx");
}

// Run the main function, allowing config path to be provided as a command-line argument
const configPath = process.argv[2] || "./config.json";
main(configPath);
