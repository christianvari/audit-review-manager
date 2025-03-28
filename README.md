# GitHub Pull Request Review Reporter

This script generates **Excel** or **PDF** reports of pull request review comments and their reactions from GitHub repositories. It fetches data using the GitHub GraphQL API and processes it to create comprehensive reports that highlight reviewer feedback, reactions, and the overall sentiment of comments on specified pull requests.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
  - [1. GitHub Personal Access Token](#1-github-personal-access-token)
  - [2. Configuration File (`config.json`)](#2-configuration-file-configjson)
- [Usage](#usage)
  - [Command-Line Arguments](#command-line-arguments)
  - [Examples](#examples)
- [Output](#output)
  - [Excel Report](#excel-report)
  - [PDF Report](#pdf-report)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Fetches pull request review comments and reactions** using the GitHub GraphQL API.
- Supports **multiple repositories and pull requests** specified in a configuration file.
- Generates reports in either **Excel** or **PDF** format.
- **Highlights comments** based on the number of positive or negative reactions.
- Provides **hyperlinks** to the original comments on GitHub for easy reference.

## Prerequisites

- **Node.js** (version 12 or higher)
- **npm** (Node Package Manager)
- A GitHub **Personal Access Token** with appropriate permissions.

## Installation

1. **Clone the Repository**

   ```bash
   git clone https://github.com/yourusername/github-pr-review-reporter.git
   cd github-pr-review-reporter
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

## Configuration

### 1. GitHub Personal Access Token

The script requires a GitHub Personal Access Token to authenticate with the GitHub API.

- **Create a Personal Access Token:**

  1. Go to [GitHub Settings](https://github.com/settings/tokens).
  2. Click on **"Generate new token"**.
  3. Provide a description and select the following scopes:
     - `repo` (Full control of private repositories)
     - `read:org` (Read org and team membership)
  4. Click **"Generate token"** and copy the token.

- **Set Up Environment Variable:**

  Create a `.env` file in the root directory of the project and add your token:

  ```env
  GITHUB_TOKEN=your_personal_access_token_here
  ```

### 2. Configuration File (`config.json`)

Create a `config.json` file in the root directory of the project to specify the repositories and pull requests you want to process.

#### Example `config.json`

```json
{
  "name": "Review_Report",
  "repositories": [
    {
      "owner": "octocat",
      "repo": "Hello-World",
      "pullRequestNumber": 42
    },
    {
      "owner": "yourusername",
      "repo": "your-repo",
      "pullRequestNumber": 101
    }
  ]
}
```

- **Parameters:**
  - `name`: The base name for the output file (without extension).
  - `repositories`: An array of repository objects containing:
    - `owner`: GitHub username or organization name.
    - `repo`: Repository name.
    - `pullRequestNumber`: The pull request number to process.

## Usage

Run the script using Node.js, optionally specifying command-line arguments for format and configuration path.

```bash
node main.js [--format=pdf|excel] [--config-path=path/to/config.json]
```

### Command-Line Arguments

- `--format`: Specifies the output format. Accepts `pdf` or `excel`. Default is `pdf`.

  ```bash
  --format=pdf
  ```

- `--config-path`: Specifies the path to the configuration file. Default is `./config.json`.

  ```bash
  --config-path=./config.json
  ```

### Examples

- **Generate a PDF Report Using Default Config**

  ```bash
  node main.js
  ```

- **Generate an Excel Report with Custom Config Path**

  ```bash
  node main.js --format=excel --config-path=./myconfig.json
  ```

## Output

The script will generate an output file named `{name}.pdf` or `{name}.xlsx` based on the `name` specified in your `config.json`.

### Excel Report

- **Structure:**

  - Each repository and pull request combination will have its own worksheet.
  - Columns include:
    - `Comment`: The truncated comment text with a hyperlink to the original comment.
    - `Reported`: Indicates the status of the comment (`✅`, `❌`, or `⚠️`).
    - Usernames of commenters and their reactions.

- **Highlights:**

  - Rows are highlighted in **green** if more than two-thirds of commenters reacted positively (`👍`).
  - Rows are highlighted in **red** if more than two-thirds of commenters reacted negatively (`👎`).

### PDF Report

- **Structure:**

  - The report includes a section for each repository and pull request.
  - Tables display comments, reported status, and reactions.
  - Comments include hyperlinks to the original GitHub comments.

- **Styling:**

  - Positive feedback rows are highlighted in **green**.
  - Negative feedback rows are highlighted in **red**.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for improvements or feature requests.

## License

This project is licensed under the [MIT License](LICENSE).

---

**Note:** Ensure that you have the necessary permissions to access the repositories and pull requests you specify. Unauthorized access may result in errors or violations of GitHub's terms of service.
