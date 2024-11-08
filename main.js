import { Octokit } from "@octokit/rest";
import fs from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
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

// Helper function to truncate comment text to 50 words
function truncateText(text, charLimit = 300) {
    if (text.length <= charLimit) {
        return text;
    }
    return text.slice(0, charLimit).concat("...");
}

// Fetch PR review comments with reactions
async function getPRReviewCommentsWithReactions(owner, repo, pullRequestNumber) {
    const rows = []; // Array to hold each comment's data for Excel
    const commenters = [];
    try {
        // Fetch review comments on the specified pull request
        const { data: comments } = await octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pullRequestNumber,
            per_page: 100,
        });

        for (const comment of comments) {
            const {
                id: commentId,
                body: commentText,
                html_url: commentUrl,
                user: user,
            } = comment;
            const truncatedText = truncateText(commentText);

            if (!commenters.includes(user.login)) {
                commenters.push(user.login);
            }

            // Row with the clickable comment text as a hyperlink
            const row = {
                Comment: { text: truncatedText, hyperlink: commentUrl }, // Use decoded URL
            };

            // Fetch reactions for each comment
            const { data: reactions } =
                await octokit.rest.reactions.listForPullRequestReviewComment({
                    owner,
                    repo,
                    comment_id: commentId,
                });

            // Process reactions and count reactions per user
            const reactionCounts = {};
            reactions.forEach((reaction) => {
                const user = reaction.user.login;
                const emoji = getEmoji(reaction.content);

                if (!reactionCounts[user]) {
                    reactionCounts[user] = [];
                }
                reactionCounts[user].push(emoji);
            });

            // Add reactions to the row and check for 👍 and 👎 reactions
            row.thumbsUpCount = 0;
            row.thumbsDownCount = 0;

            Object.keys(reactionCounts).forEach((user) => {
                const userReactions = reactionCounts[user];
                const emojiString = userReactions.join(" ");
                row[user] = emojiString;

                // Count 👍 and 👎 reactions
                if (userReactions.includes("👍")) row.thumbsUpCount += 1;
                if (userReactions.includes("👎")) row.thumbsDownCount += 1;
            });

            rows.push(row);
        }
    } catch (error) {
        console.error(
            `Error fetching review comments or reactions for ${owner}/${repo} - PR #${pullRequestNumber}:`,
            error,
        );
    }

    return { rows, commenters };
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

    const workbook = new ExcelJS.Workbook();

    for (const { owner, repo, pullRequestNumber } of config) {
        console.log(`\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`);
        const { rows, commenters } = await getPRReviewCommentsWithReactions(
            owner,
            repo,
            pullRequestNumber,
        );

        const worksheet = workbook.addWorksheet(`${repo}-PR#${pullRequestNumber}`);

        // Add headers
        const headerRow = ["Comment", ...commenters];
        worksheet.columns = headerRow.map((key, i) => ({
            header: key,
            key: key,
            width: i == 0 ? 100 : 15, // Default width, will auto-adjust later
        }));

        // Style header row
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
        };

        // Add rows and hyperlinks
        rows.forEach((dataRow) => {
            const row = worksheet.addRow(dataRow);

            // Format comment column as clickable hyperlink
            const commentCell = row.getCell("Comment");
            commentCell.value = {
                text: dataRow.Comment.text,
                hyperlink: dataRow.Comment.hyperlink,
            };
            commentCell.font = { color: { argb: "FF0000FF" }, underline: true }; // Blue and underlined
            commentCell.alignment = { wrapText: true };

            if (dataRow.thumbsUpCount + 1 > (2 / 3) * commenters.length) {
                row.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "CCFFCC" },
                };
            }

            // Highlight row in light red if > 2/3 of commenters gave a 👎
            if (dataRow.thumbsDownCount - 1 > (2 / 3) * commenters.length) {
                row.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFCCCC" },
                };
            }
        });
    }

    // Write workbook to file with the name "Review.xlsx"
    await workbook.xlsx.writeFile("Review.xlsx");
    console.log("Excel file created: Review.xlsx");
}

// Run the main function, allowing config path to be provided as a command-line argument
const configPath = process.argv[2] || "./config.json";
main(configPath);
