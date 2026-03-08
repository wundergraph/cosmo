export interface ReviewComment {
  file: string;
  line: number | null;
  author: string;
  is_bot: boolean;
  diff_hunk: string;
  body: string;
  category?: string;
  actionability?: "high" | "medium" | "low";
  domain_specificity?: "high" | "low";
}

export interface IssueComment {
  author: string;
  is_bot: boolean;
  date: string;
  body: string;
}

export interface Review {
  author: string;
  state: string;
  body: string;
}

export interface PRRecord {
  pr_number: number;
  pr_title: string;
  pr_author: string;
  pr_state: string;
  pr_created: string;
  pr_merged: string;
  pr_closed: string;
  pr_url: string;
  pr_labels: string[];
  description: string;
  diff: string;
  review_comments: ReviewComment[];
  issue_comments: IssueComment[];
  reviews: Review[];
}
