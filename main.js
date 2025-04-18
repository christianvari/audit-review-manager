import { graphql } from "@octokit/graphql";
import fs from "fs/promises";
import ExcelJS from "exceljs";
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();

// Color constants for consistent styling
const COLORS = {
    GREEN: { excel: "CCFFCC", html: "#ccffcc" }, // High percentage/positive
    YELLOW: { excel: "FFFFCC", html: "#ffffcc" }, // Medium-high percentage
    ORANGE: { excel: "FFEB9C", html: "#ffeb9c" }, // Medium-low percentage
    RED: { excel: "FFCCCC", html: "#ffcccc" }, // Low percentage/negative
};

// Thresholds for color transitions
const THRESHOLD = {
    HIGH: 90, // Green
    MEDIUM: 70, // Yellow
    LOW: 50, // Orange, below this is red
};

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

function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
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
    const comments = []; // Store all comments for later reaction processing
    // Counter for issues statistics
    const stats = {
        reported: 0, // Resolved with rocket (✅)
        nonReported: 0, // Resolved without rocket (❌)
        pending: 0, // Not resolved (no status)
    };

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

        // First pass: collect all commenters and build comment data
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
                    proposer: commenter.login,
                };

                // Only set Reported status for resolved comments
                // Not resolved comments don't get a Reported status

                // Process reactions
                const reactions = comment.reactions.nodes;

                // Initialize reaction counts
                row.thumbsUpCount = 0;
                row.thumbsDownCount = 0;
                row[commenter.login] = "Proposer";
                row.reactions = {}; // Track who reacted

                let hasRocket = false;

                reactions.forEach((reaction) => {
                    const user = reaction.user.login;
                    if (!commenters.includes(user)) {
                        commenters.push(user);
                    }
                    const emoji = getEmoji(reaction.content);

                    switch (emoji) {
                        case "🚀":
                            hasRocket = true;
                            break;
                        case "👍":
                            row[user] = emoji;
                            row.thumbsUpCount += 1;
                            row.reactions[user] = true;
                            break;
                        case "👎":
                            row[user] = emoji;
                            row.thumbsDownCount += 1;
                            row.reactions[user] = true;
                            break;
                        case "👀":
                            break;
                        default:
                            console.warn("Incorrect emoji", emoji, user, commentUrl);
                    }
                });

                // Set Reported status based on isResolved and hasRocket
                if (isResolved) {
                    row.Reported = hasRocket ? "✅" : "❌";
                    // Update stats
                    if (hasRocket) {
                        stats.reported++;
                    } else {
                        stats.nonReported++;
                    }
                } else {
                    // Not resolved -> pending
                    stats.pending++;
                }

                rows.push(row);
                comments.push(row);
            }
        }
    } catch (error) {
        console.error(
            `Error fetching review comments or reactions for ${owner}/${repo} - PR #${pullRequestNumber}:`,
            error,
        );
    }

    // Initialize reaction tracker with all commenters
    const reactionsTracker = {};
    commenters.forEach((username) => {
        reactionsTracker[username] = { reacted: 0, total: 0 };
    });

    // Second pass: calculate reactions and totals
    comments.forEach((comment) => {
        const proposer = comment.proposer;

        // For each commenter, increment their total count (except for the comment proposer)
        commenters.forEach((username) => {
            if (username !== proposer) {
                reactionsTracker[username].total += 1;

                // Check if this user reacted to this comment
                if (comment.reactions[username]) {
                    reactionsTracker[username].reacted += 1;
                }
            }
        });
    });

    // Calculate percentages and format totals
    const reactionStats = {};
    commenters.forEach((username) => {
        const stats = reactionsTracker[username];
        const percentage =
            stats.total === 0 ? 100 : Math.round((stats.reacted / stats.total) * 100);
        reactionStats[username] = {
            text: `${stats.reacted}/${stats.total} (${percentage}%)`,
            percentage: percentage,
        };
    });

    return { rows, commenters, reactionStats, stats };
}

// Function to get color based on percentage
function getColorForPercentage(percentage) {
    if (percentage >= THRESHOLD.HIGH) {
        return COLORS.GREEN;
    } else if (percentage >= THRESHOLD.MEDIUM) {
        return COLORS.YELLOW;
    } else if (percentage >= THRESHOLD.LOW) {
        return COLORS.ORANGE;
    } else {
        return COLORS.RED;
    }
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
    const generatedOn = formatDateTime(new Date()); // Get current date and time
    let index = 0;

    for (const { owner, repo, pullRequestNumber } of repos) {
        console.info(
            `\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`,
        );
        const { rows, commenters, reactionStats, stats } =
            await getPRReviewCommentsWithReactions(owner, repo, pullRequestNumber);

        const worksheet = workbook.addWorksheet(
            `${index}-${repo}-PR#${pullRequestNumber}`,
        );

        // Add date and time to the worksheet header
        worksheet.headerFooter.oddHeader = `&CGenerated on ${generatedOn}`;

        // Add issues summary table
        worksheet.addRow(["Issues Summary"]);
        worksheet.getRow(1).font = { bold: true, size: 18 };

        worksheet.addRow(["Category", "Count"]);
        worksheet.getRow(2).font = { bold: true, size: 16 };

        // Add the stats rows
        worksheet.addRow(["Reported (✅)", stats.reported]);
        worksheet.addRow(["Non-Reported (❌)", stats.nonReported]);
        worksheet.addRow(["Pending", stats.pending]);

        // Style the stats cells
        worksheet.getRow(3).font = { size: 14 };
        worksheet.getRow(4).font = { size: 14 };
        worksheet.getRow(5).font = { size: 14 };
        worksheet.getRow(6).font = { size: 14, bold: true };

        // Color cells based on category
        worksheet.getRow(3).getCell(2).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.GREEN.excel },
        };

        worksheet.getRow(4).getCell(2).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.RED.excel },
        };

        worksheet.getRow(5).getCell(2).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: COLORS.YELLOW.excel },
        };

        // Add a blank row as separator
        worksheet.addRow([]);

        // Add summary section for reaction stats
        worksheet.addRow(["Reaction Completion Stats"]);
        worksheet.addRow(["Reviewer", "Reactions Completed"]);

        // Style the header
        worksheet.getRow(8).font = { bold: true, size: 16 };
        worksheet.getRow(9).font = { bold: true, size: 14 };

        // Add stats for each commenter
        let rowIndex = 10;
        commenters.forEach((commenter) => {
            const statRow = worksheet.addRow([commenter, reactionStats[commenter].text]);
            worksheet.getRow(rowIndex).font = { size: 14 };

            // Color the cell based on the percentage
            const percentage = reactionStats[commenter].percentage;
            const color = getColorForPercentage(percentage);
            statRow.getCell(2).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: color.excel },
            };

            rowIndex++;
        });

        // Add a blank row as separator
        worksheet.addRow([]);
        rowIndex++;

        // Add headers for comments section
        const headerRow = ["Comment", "Reported", ...commenters];
        const headerRowIndex = rowIndex;
        worksheet.addRow(headerRow);

        // Style comment section header
        worksheet.getRow(headerRowIndex).font = { bold: true, size: 16 };
        worksheet.getRow(headerRowIndex).alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
        };

        // Set column widths
        worksheet.getColumn(1).width = 100;
        headerRow.slice(1).forEach((_, index) => {
            worksheet.getColumn(index + 2).width = 25;
        });

        // Add rows and hyperlinks
        rows.forEach((dataRow) => {
            const row = worksheet.addRow([
                dataRow.Comment.text,
                dataRow.Reported || "",
                ...commenters.map((commenter) => dataRow[commenter] || ""),
            ]);

            row.font = { size: 16 };

            // Format comment column as clickable hyperlink
            const commentCell = row.getCell(1);
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

            if (dataRow.thumbsUpCount + 1 >= (2 / 3) * commenters.length) {
                row.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: COLORS.GREEN.excel },
                };
            }

            // Highlight row in light red if > 2/3 of commenters gave a 👎
            if (dataRow.thumbsDownCount >= (2 / 3) * (commenters.length - 1)) {
                row.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: COLORS.RED.excel },
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
    const generatedOn = formatDateTime(new Date()); // Get current date and time
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
        h1, h2 {
          text-align: center;
        }
        p.generated-on {
          text-align: right;
          font-style: italic;
          color: #555;
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
          background-color: ${COLORS.GREEN.html};
        }
        .red-row {
          background-color: ${COLORS.RED.html};
        }
        a {
          color: #0066cc;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
        .summary-table {
          width: 50%;
          margin: 0 auto 30px auto;
        }
      </style>
    </head>
    <body>
        <p class="generated-on">Generated on ${generatedOn}</p>

  `;

    for (const { owner, repo, pullRequestNumber } of repos) {
        console.info(
            `\nProcessing ${owner}/${repo} - Pull Request #${pullRequestNumber}`,
        );
        const { rows, commenters, reactionStats, stats } =
            await getPRReviewCommentsWithReactions(owner, repo, pullRequestNumber);

        // Add a title for each PR
        htmlContent += `<h1>${owner}/${repo} - Pull Request #${pullRequestNumber}</h1>`;

        // Add issues summary table
        htmlContent += `
          <h2>Issues Summary</h2>
          <table class="summary-table">
            <tr>
              <th>Category</th>
              <th>Count</th>
            </tr>
            <tr>
              <td>Reported (✅)</td>
              <td style="background-color: ${COLORS.GREEN.html}">${stats.reported}</td>
            </tr>
            <tr>
              <td>Non-Reported (❌)</td>
              <td style="background-color: ${COLORS.RED.html}">${stats.nonReported}</td>
            </tr>
            <tr>
              <td>Pending</td>
              <td style="background-color: ${COLORS.YELLOW.html}">${stats.pending}</td>
            </tr>
          </table>
        `;

        // Add reaction stats summary table
        htmlContent += `
          <h2>Reaction Completion Stats</h2>
          <table class="summary-table">
            <tr>
              <th>Reviewer</th>
              <th>Reactions Completed</th>
            </tr>
        `;

        commenters.forEach((commenter) => {
            const percentage = reactionStats[commenter].percentage;
            const color = getColorForPercentage(percentage);
            htmlContent += `
              <tr>
                <td>${commenter}</td>
                <td style="background-color: ${color.html}">${reactionStats[commenter].text}</td>
              </tr>
            `;
        });

        htmlContent += `</table>`;

        // Prepare table headers for comments
        const headers = ["Comment", "Reported", ...commenters];
        htmlContent += `<h2>Comments</h2><table><tr>`;
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
            if (thumbsUpCount + 1 >= (2 / 3) * totalCommenters) {
                rowClass = "green-row";
            } else if (thumbsDownCount >= (2 / 3) * (totalCommenters - 1)) {
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
