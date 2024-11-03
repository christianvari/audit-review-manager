const { Octokit } = require("@octokit/rest");
const fs = require("fs").promises;
const path = require("path");
const xlsx = require("xlsx");
require("dotenv").config();

// Initialize Octokit with authentication
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
});

async function loadConfig() {
    const configPath = path.join(__dirname, "config.json");
    try {
        const data = await fs.readFile(configPath, "utf8");
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading config file:", error);
        return [];
    }
}

async function getCommentsWithReactions(owner, repo, pullRequestNumber) {
    const rows = []; // Array to hold each comment's data for Excel

    try {
        // Fetch comments on the specified pull request
        const { data: comments } = await octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: pullRequestNumber,
        });

        for (const comment of comments) {
            const {
                id: commentId,
                body: commentText,
                user: { login: commentAuthor },
            } = comment;
            const row = { CommentAuthor: commentAuthor, CommentText: commentText };

            // Fetch reactions for each comment
            const { data: reactions } = await octokit.rest.reactions.listForIssueComment({
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
            `Error fetching comments or reactions for ${owner}/${repo} - PR #${pullRequestNumber}:`,
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

async function main() {
    const config = await loadConfig();

    if (config.length === 0) {
        console.log("No repositories and pull requests found in config.");
        return;
    }

    let allRows = []; // Collect all rows from all PRs

    for (const { owner, repo, pullRequestNumber } of config) {
        console.log(`\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`);
        const rows = await getCommentsWithReactions(owner, repo, pullRequestNumber);
        allRows = allRows.concat(rows);
    }

    // Write to Excel file
    createExcelFile(allRows);
}

function createExcelFile(data) {
    const wb = xlsx.utils.book_new(); // Create a new workbook
    const ws = xlsx.utils.json_to_sheet(data); // Convert data to sheet format

    // Append sheet to workbook
    xlsx.utils.book_append_sheet(wb, ws, "PR Comments & Reactions");

    // Write workbook to file
    xlsx.writeFile(wb, "PR_Comments_Reactions.xlsx");
    console.log("Excel file created: PR_Comments_Reactions.xlsx");
}

// Run the main function
main();
