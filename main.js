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
function truncateText(text, wordLimit = 50) {
    const words = text.split(" ");
    if (words.length <= wordLimit) {
        return text;
    }
    return words.slice(0, wordLimit).join(" ") + "...";
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
            const { id: commentId, body: commentText, html_url: commentUrl } = comment;
            const truncatedText = truncateText(commentText);

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

    const workbook = new ExcelJS.Workbook();

    for (const { owner, repo, pullRequestNumber } of config) {
        console.log(`\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`);
        const rows = await getPRReviewCommentsWithReactions(
            owner,
            repo,
            pullRequestNumber,
        );

        const worksheet = workbook.addWorksheet(`${repo}-PR#${pullRequestNumber}`, {
            properties: { defaultRowHeight: 20 },
        });

        // Add headers
        const headerRow = Object.keys(rows[0]);
        worksheet.columns = headerRow.map((key) => ({
            header: key,
            key: key,
            width: 25, // Default width, will auto-adjust later
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
                tooltip: dataRow.Comment.hyperlink,
            };
            commentCell.font = { color: { argb: "FF0000FF" }, underline: true }; // Blue and underlined
            commentCell.alignment = { wrapText: true };
        });

        // Auto-adjust column widths based on content
        worksheet.columns.forEach((column) => {
            let maxLength = 10;
            column.eachCell({ includeEmpty: true }, (cell) => {
                const cellLength = cell.value ? cell.value.toString().length : 10;
                maxLength = Math.max(maxLength, cellLength);
            });
            column.width = maxLength + 5;
        });
    }

    // Write workbook to file with the name "Review.xlsx"
    await workbook.xlsx.writeFile("Review.xlsx");
    console.log("Excel file created: Review.xlsx");
}

// Run the main function, allowing config path to be provided as a command-line argument
const configPath = process.argv[2] || "./config.json";
main(configPath);
