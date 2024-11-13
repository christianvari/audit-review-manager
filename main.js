import { graphql } from "@octokit/graphql";
import fs from "fs/promises";
import ExcelJS from "exceljs";
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();

// Initialize the GraphQL client with authentication
const graphqlWithAuth = graphql.defaults({
    headers: {
        authorization: `token ${process.env.GITHUB_TOKEN}`,
    },
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

// Fetch PR review comments with reactions using GraphQL
async function getPRReviewCommentsWithReactions(owner, repo, pullRequestNumber) {
    const rows = []; // Array to hold each comment's data for Excel or PDF
    const commenters = [];
    try {
        // GraphQL query to fetch review threads, comments, and reactions
        const query = `
      query ($owner: String!, $repo: String!, $pullRequestNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pullRequestNumber) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                comments(first: 1) {
                  nodes {
                    id
                    body
                    url
                    author {
                      login
                    }
                    reactions(first: 50) {
                      nodes {
                        content
                        user {
                          login
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

        const result = await graphqlWithAuth(query, {
            owner,
            repo,
            pullRequestNumber,
        });

        const reviewThreads = result.repository.pullRequest.reviewThreads.nodes;

        for (const thread of reviewThreads) {
            const isResolved = thread.isResolved;

            for (const comment of thread.comments.nodes) {
                const {
                    id: commentId,
                    body: commentText,
                    url: commentUrl,
                    author: commenter,
                } = comment;

                const truncatedText = truncateText(commentText);

                if (!commenters.includes(commenter.login)) {
                    commenters.push(commenter.login);
                }

                // Row with the clickable comment text as a hyperlink
                const row = {
                    Comment: { text: truncatedText, hyperlink: commentUrl },
                };

                if (isResolved) {
                    row.Reported = "❌";
                }

                // Process reactions
                const reactions = comment.reactions.nodes;

                // Initialize reaction counts
                row.thumbsUpCount = 0;
                row.thumbsDownCount = 0;
                row[commenter.login] = "Proposer";

                reactions.forEach((reaction) => {
                    const user = reaction.user.login;
                    if (!commenters.includes(user)) {
                        commenters.push(user);
                    }
                    const emoji = getEmoji(reaction.content);

                    if (emoji === "🚀") {
                        row.Reported = "✅";
                        if (isResolved) {
                            console.warn(
                                "Comment is resolved but there is the rocket emoji",
                                truncatedText,
                            );
                            row.Reported = "⚠️";
                        }

                        return;
                    }

                    row[user] = emoji;
                    if (emoji === "👍") row.thumbsUpCount += 1;
                    if (emoji === "👎") row.thumbsDownCount += 1;
                });

                rows.push(row);
            }
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
        THUMBS_UP: "👍",
        THUMBS_DOWN: "👎",
        LAUGH: "😄",
        HOORAY: "🎉",
        CONFUSED: "😕",
        HEART: "❤️",
        ROCKET: "🚀",
        EYES: "👀",
    };
    return emojiMap[content.toUpperCase()] || content;
}

async function renderExcel(repos, name) {
    const workbook = new ExcelJS.Workbook();
    let index = 0;

    for (const { owner, repo, pullRequestNumber } of repos) {
        console.info(
            `\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`,
        );
        const { rows, commenters } = await getPRReviewCommentsWithReactions(
            owner,
            repo,
            pullRequestNumber,
        );

        const worksheet = workbook.addWorksheet(
            `${index}-${repo}-PR#${pullRequestNumber}`,
        );

        // Add headers
        const headerRow = ["Comment", "Reported", ...commenters];
        worksheet.columns = headerRow.map((key, i) => ({
            header: key,
            key: key,
            width: i === 0 ? 100 : 25, // Set width for columns
        }));

        // Style header row
        worksheet.getRow(1).font = { bold: true, size: 16 };
        worksheet.getRow(1).alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
        };

        // Add rows and hyperlinks
        rows.forEach((dataRow) => {
            const row = worksheet.addRow(dataRow);
            row.font = { size: 16 };

            // Format comment column as clickable hyperlink
            const commentCell = row.getCell("Comment");
            commentCell.value = {
                text: dataRow.Comment.text,
                hyperlink: dataRow.Comment.hyperlink,
            };
            commentCell.font = {
                color: { argb: "FF0000FF" },
                underline: true,
                size: 16,
            }; // Blue and underlined
            row.alignment = { vertical: "middle", wrapText: true };

            if (dataRow.thumbsUpCount > (2 / 3) * commenters.length - 1) {
                row.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "CCFFCC" },
                };
            }

            // Highlight row in light red if > 2/3 of commenters gave a 👎
            if (dataRow.thumbsDownCount > (2 / 3) * commenters.length - 1) {
                row.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFCCCC" },
                };
            }
        });

        index++;
    }

    // Write workbook to file with the name "Review.xlsx"
    await workbook.xlsx.writeFile(`${name}.xlsx`);
    console.info(`Excel file created: ${name}.xlsx`);
}

async function renderPDF(repos, name) {
    let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Review Report</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
        }
        h1 {
          text-align: center;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 40px;
        }
        th, td {
          border: 1px solid #dddddd;
          text-align: left;
          padding: 8px;
          vertical-align: top;
        }
        th {
          background-color: #f2f2f2;
        }
        .green-row {
          background-color: #ccffcc;
        }
        .red-row {
          background-color: #ffcccc;
        }
        a {
          color: #0066cc;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
  `;

    for (const { owner, repo, pullRequestNumber } of repos) {
        console.info(
            `\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`,
        );
        const { rows, commenters } = await getPRReviewCommentsWithReactions(
            owner,
            repo,
            pullRequestNumber,
        );

        // Add a title for each PR
        htmlContent += `<h1>${owner}/${repo} - Pull Request #${pullRequestNumber}</h1>`;

        // Prepare table headers
        const headers = ["Comment", "Reported", ...commenters];
        htmlContent += `<table><tr>`;
        headers.forEach((header) => {
            htmlContent += `<th>${header}</th>`;
        });
        htmlContent += `</tr>`;

        // Add table rows
        rows.forEach((dataRow) => {
            const thumbsUpCount = dataRow.thumbsUpCount;
            const thumbsDownCount = dataRow.thumbsDownCount;
            const totalCommenters = commenters.length;

            let rowClass = "";
            if (thumbsUpCount > (2 / 3) * totalCommenters - 1) {
                rowClass = "green-row";
            } else if (thumbsDownCount > (2 / 3) * totalCommenters - 1) {
                rowClass = "red-row";
            }

            htmlContent += `<tr class="${rowClass}">`;

            // Comment column with hyperlink
            htmlContent += `<td><a href="${dataRow.Comment.hyperlink}">${dataRow.Comment.text}</a></td>`;

            // Reported column
            htmlContent += `<td>${dataRow.Reported || ""}</td>`;

            // Reactions from commenters
            commenters.forEach((commenter) => {
                htmlContent += `<td>${dataRow[commenter] || ""}</td>`;
            });

            htmlContent += `</tr>`;
        });

        htmlContent += `</table>`;
    }

    htmlContent += `
    </body>
    </html>
  `;

    // Launch Puppeteer and generate PDF
    console.info("Generating PDF...");
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Set HTML content
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    // Generate PDF with landscape orientation
    await page.pdf({
        path: `${name}.pdf`,
        format: "A4",
        landscape: true, // Set landscape orientation
        printBackground: true,
        margin: { top: "20mm", bottom: "20mm", left: "10mm", right: "10mm" },
    });

    await browser.close();
    console.info(`PDF file created: ${name}.pdf`);
}

// Main function to process each PR from config
async function main(configPath, format) {
    const config = await loadConfig(configPath);

    const repos = config.repositories;

    if (repos.length === 0) {
        console.error("No repositories and pull requests found in config.");
        return;
    }

    if (format === "excel") {
        await renderExcel(repos, config.name);
    } else if (format === "pdf") {
        await renderPDF(repos, config.name);
    } else {
        console.error(`Invalid format specified: ${format}`);
    }
}

// Parse command-line arguments
const args = process.argv.slice(2);
let configPath = "./config.json";
let format = "pdf"; // Default format

args.forEach((arg) => {
    if (arg.startsWith("--format=")) {
        format = arg.split("=")[1];
    }
    if (arg.startsWith("--config-path=")) {
        configPath = arg.split("=")[1];
    }
});

// Run the main function with the provided config path and format
main(configPath, format);
