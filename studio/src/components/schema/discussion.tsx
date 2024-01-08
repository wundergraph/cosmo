import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUser } from "@/hooks/use-user";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  DotsVerticalIcon,
  FontBoldIcon,
  FontItalicIcon,
  ListBulletIcon,
  StrikethroughIcon,
} from "@radix-ui/react-icons";
import { useMutation } from "@tanstack/react-query";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EnumStatusCode } from "@wundergraph/cosmo-connect/dist/common/common_pb";
import {
  createDiscussion,
  deleteDiscussionComment,
  replyToDiscussion,
  updateDiscussionComment,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery";
import {
  DiscussionComment,
  OrgMember,
} from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { formatDistanceToNow } from "date-fns";
import { useContext, useEffect, useState } from "react";
import { PiListNumbers } from "react-icons/pi";
import { Markdown } from "tiptap-markdown";
import { GraphContext } from "../layout/graph-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useToast } from "../ui/use-toast";

const getEditorOptions = (opts?: {
  className?: string;
  placeholder?: string;
}) => {
  return {
    editorProps: {
      attributes: {
        class: cn(
          "prose-sm prose-headings:font-bold dark:prose-invert h-[150px] w-full rounded-md rounded-br-none rounded-bl-none border border-input bg-transparent px-3 py-2 border-b-0 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 scrollbar-custom overflow-auto prose-code:px-1 prose-code:bg-secondary prose-pre:bg-secondary",
          opts?.className,
        ),
      },
    },
    extensions: [
      StarterKit.configure({
        orderedList: {
          HTMLAttributes: {
            class: "list-decimal pl-4",
          },
        },
        bulletList: {
          HTMLAttributes: {
            class: "list-disc pl-4",
          },
        },
      }),
      Placeholder.configure({
        placeholder: opts?.placeholder ?? "Write something to discuss about...",
      }),
      Markdown,
    ],
  };
};

const RichTextEditorToolbar = ({ editor }: { editor: Editor }) => {
  return (
    <div className="flex flex-row items-center gap-1 rounded-bl-md rounded-br-md border border-input bg-transparent p-1">
      <Toggle
        size="sm"
        pressed={editor.isActive("bold")}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
      >
        <FontBoldIcon className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive("italic")}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
      >
        <FontItalicIcon className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive("strike")}
        onPressedChange={() => editor.chain().focus().toggleStrike().run()}
      >
        <StrikethroughIcon className="h-4 w-4" />
      </Toggle>
      <Separator orientation="vertical" className="h-8 w-[1px]" />
      <Toggle
        size="sm"
        pressed={editor.isActive("bulletList")}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListBulletIcon className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive("orderedList")}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <PiListNumbers className="h-4 w-4" />
      </Toggle>
    </div>
  );
};

export const CommentCard = ({
  author,
  comment,
  discussionId,
  isOpeningComment,
  onUpdate,
  onDelete,
}: {
  discussionId: string;
  author?: OrgMember;
  comment: DiscussionComment;
  isOpeningComment: boolean;
  onUpdate?: () => void;
  onDelete?: () => void;
}) => {
  const user = useUser();

  const [editable, setEditable] = useState(false);

  const { toast } = useToast();

  const { mutate: update, isPending: isUpdating } = useMutation({
    ...updateDiscussionComment.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: "Could not update comment",
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      toast({
        title: "Comment updated successfully",
      });

      setEditable(false);

      onUpdate?.();
    },
  });

  const { mutate: deleteComment, isPending: isDeleting } = useMutation({
    ...deleteDiscussionComment.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: `Could not delete ${
            isOpeningComment ? "discussion" : "comment"
          }`,
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      toast({
        title: `${
          isOpeningComment ? "Discussion" : "Comment"
        } deleted successfully`,
      });

      onDelete?.();
    },
  });

  const editor = useEditor(
    {
      ...getEditorOptions({
        className: !editable ? "border-none h-auto max-h-[96px] p-0 pl-8" : "",
      }),
      editable,
    },
    [editable],
  );

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(JSON.parse(comment?.contentJson ?? "{}"));
  }, [comment.contentJson, editor]);

  const canEdit = user?.id === author?.userID;
  const canDelete =
    user?.id === author?.userID ||
    user?.currentOrganization.roles.includes("admin");

  return (
    <div className="px-4">
      <div className="mb-1 flex items-start gap-x-2">
        <Avatar className="relative h-6 w-6 cursor-pointer">
          <AvatarFallback className="rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 text-xs text-white">
            {author?.email[0]}
          </AvatarFallback>
        </Avatar>
        <div className="flex w-full flex-col">
          <div className="flex w-full items-start">
            <div className="flex flex-wrap items-center gap-x-2">
              <h4 className="text-sm font-semibold">
                {author?.email ?? "unknown author"}
              </h4>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger>
                      {formatDistanceToNow(new Date(comment.createdAt), {
                        addSuffix: true,
                      })}
                    </TooltipTrigger>
                    <TooltipContent>
                      Created at {formatDateTime(new Date(comment.createdAt))}
                    </TooltipContent>
                  </Tooltip>
                </p>
                {comment.updatedAt && (
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger>
                      <Badge variant="outline">edited</Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      Last updated at{" "}
                      {formatDateTime(new Date(comment.updatedAt))}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-x-2">
              <AlertDialog>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="-mr-2" variant="ghost" size="icon-sm">
                      <DotsVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="w-full justify-start font-normal"
                      asChild
                      onClick={() => {
                        setEditable(true);
                      }}
                    >
                      <Button variant="ghost" size="sm" disabled={!canEdit}>
                        Edit
                      </Button>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      asChild
                      className="justify-start font-normal text-destructive"
                    >
                      <AlertDialogTrigger className="w-full" asChild>
                        <Button variant="ghost" size="sm" disabled={!canDelete}>
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {isOpeningComment
                        ? `This is the opening comment. Deleting this will delete the
                      discussion and associated replies.`
                        : `Are you sure you want to delete this reply from the thread?`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        deleteComment({
                          discussionId,
                          commentId: comment.id,
                        });
                      }}
                    >
                      {isOpeningComment ? `Delete Discussion` : `Delete reply`}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          {editable && (
            <div className="mt-2 h-auto w-full max-w-3xl rounded-md">
              <EditorContent editor={editor} />
              {editor ? <RichTextEditorToolbar editor={editor} /> : null}
              <div className="mt-2 flex items-center justify-end space-x-2">
                <Button variant="secondary" onClick={() => setEditable(false)}>
                  Cancel
                </Button>
                <Button
                  isLoading={isUpdating}
                  onClick={() => {
                    update({
                      discussionId,
                      commentId: comment.id,
                      contentJson: JSON.stringify(editor?.getJSON()),
                      contentMarkdown:
                        editor?.storage["markdown"].getMarkdown(),
                    });
                  }}
                >
                  Update
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {!editable && <EditorContent editor={editor} />}
    </div>
  );
};

export const NewDiscussion = ({
  lineNo,
  versionId,
  targetId,
  setNewDiscussionLine,
  refetch,
  className,
  placeholder,
}: {
  lineNo: number;
  versionId: string;
  targetId: string;
  setNewDiscussionLine: (line: number) => void;
  refetch: () => void;
  className?: string;
  placeholder?: string;
}) => {
  const { toast } = useToast();

  const graph = useContext(GraphContext);

  const { mutate, isPending } = useMutation({
    ...createDiscussion.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: "Could not start discussion",
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      toast({
        title: "Discussion started successfully",
      });

      setNewDiscussionLine(-1);
      refetch();
    },
  });

  const editor = useEditor(
    getEditorOptions({
      placeholder,
    }),
  );

  return (
    <div
      className={cn(
        "flex h-auto w-screen flex-1 items-center justify-start border-y bg-background px-2 py-2 font-sans",
        className,
      )}
    >
      <div className="h-auto w-full max-w-3xl rounded-md">
        <EditorContent editor={editor} />
        {editor ? <RichTextEditorToolbar editor={editor} /> : null}
        <div className="mt-2 flex items-center justify-end space-x-2">
          <Button variant="secondary" onClick={() => setNewDiscussionLine(-1)}>
            Cancel
          </Button>
          <Button
            isLoading={isPending}
            onClick={() => {
              if (!editor) return;
              mutate({
                contentJson: JSON.stringify(editor.getJSON()),
                contentMarkdown: editor?.storage["markdown"].getMarkdown(),
                referenceLine: lineNo,
                schemaVersionId: versionId,
                targetId,
              });
            }}
          >
            Start discussion
          </Button>
        </div>
      </div>
    </div>
  );
};

export const NewComment = ({
  discussionId,
  refetch,
}: {
  discussionId: string;
  refetch: () => void;
}) => {
  const { toast } = useToast();

  const editor = useEditor(getEditorOptions());

  const [showEditor, setShowEditor] = useState(false);

  const { mutate, isPending } = useMutation({
    ...replyToDiscussion.useMutation(),
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: "destructive",
          title: "Could not send reply",
          description: data.response?.details ?? "Please try again",
        });
        return;
      }

      setShowEditor(false);
      editor?.commands.setContent("");
      refetch();
    },
  });

  return (
    <div className="flex h-auto w-full items-center justify-start bg-background font-sans">
      {showEditor ? (
        <div className="h-auto w-full max-w-3xl rounded-md">
          <EditorContent editor={editor} />
          {editor ? <RichTextEditorToolbar editor={editor} /> : null}
          <div className="mt-2 flex items-center justify-end space-x-2">
            <Button variant="secondary" onClick={() => setShowEditor(false)}>
              Cancel
            </Button>
            <Button
              isLoading={isPending}
              onClick={() => {
                if (!editor) return;
                mutate({
                  discussionId,
                  contentJson: JSON.stringify(editor.getJSON()),
                  contentMarkdown: editor?.storage["markdown"].getMarkdown(),
                });
              }}
            >
              Submit
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex w-full">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setShowEditor(true)}
          >
            Reply in thread
          </Button>
        </div>
      )}
    </div>
  );
};
