import { cn } from "@/lib/utils";
import { VariantProps } from "class-variance-authority";
import React from "react";
import { Input } from "../input";
import { tagVariants } from "./tag";
import { TagList } from "./tag-list";

type OmittedInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size" | "value"
>;

export type Tag = {
  id: string;
  text: string;
};

export interface TagInputStyleClassesProps {
  inlineTagsContainer?: string;
  tag?: {
    body?: string;
    closeButton?: string;
  };
  input?: string;
}

export interface TagInputProps
  extends OmittedInputProps,
    VariantProps<typeof tagVariants> {
  placeholder?: string;
  tags: Tag[];
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  maxTags?: number;
  minTags?: number;
  readOnly?: boolean;
  disabled?: boolean;
  onTagAdd?: (tag: string) => void;
  onTagRemove?: (tag: string) => void;
  allowDuplicates?: boolean;
  showCount?: boolean;
  placeholderWhenFull?: string;
  delimiterList: string[];
  truncate?: number;
  value?: string | number | readonly string[] | { id: string; text: string }[];
  direction?: "row" | "column";
  onInputChange?: (value: string) => void;
  customTagRenderer?: (tag: Tag, isActiveTag: boolean) => React.ReactNode;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onTagClick?: (tag: Tag) => void;
  inputFieldPosition?: "bottom" | "top";
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
  activeTagIndex: number | null;
  setActiveTagIndex: React.Dispatch<React.SetStateAction<number | null>>;
  styleClasses?: TagInputStyleClassesProps;
}

const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(
  (props, ref) => {
    const {
      id,
      placeholder,
      tags,
      setTags,
      variant,
      size,
      shape,
      maxTags,
      onTagAdd,
      onTagRemove,
      allowDuplicates,
      showCount,
      placeholderWhenFull = "Max tags reached",
      delimiterList,
      truncate,
      borderStyle,
      textCase,
      interaction,
      animation,
      textStyle,
      direction = "row",
      onInputChange,
      customTagRenderer,
      onFocus,
      onBlur,
      onTagClick,
      inputFieldPosition = "bottom",
      inputProps = {},
      activeTagIndex,
      setActiveTagIndex,
      styleClasses = {},
      disabled,
    } = props;

    const [inputValue, setInputValue] = React.useState("");
    const [tagCount, setTagCount] = React.useState(Math.max(0, tags.length));
    const inputRef = React.useRef<HTMLInputElement>(null);

    if (
      (maxTags !== undefined && maxTags < 0) ||
      (props.minTags !== undefined && props.minTags < 0)
    ) {
      console.warn("maxTags and minTags cannot be less than 0");
      // error
      return null;
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);
      onInputChange?.(newValue);
    };

    const handleInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
      setActiveTagIndex(null); // Reset active tag index when the input field gains focus
      onFocus?.(event);
    };

    const handleInputBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      onBlur?.(event);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (delimiterList.includes(e.key)) {
        e.preventDefault();
        const newTagText = inputValue.trim();

        const newTagId = crypto.randomUUID();

        if (
          newTagText &&
          (allowDuplicates || !tags.some((tag) => tag.text === newTagText)) &&
          (maxTags === undefined || tags.length < maxTags)
        ) {
          setTags([...tags, { id: newTagId, text: newTagText }]);
          onTagAdd?.(newTagText);
          setTagCount((prevTagCount) => prevTagCount + 1);
        }
        setInputValue("");
      } else {
        switch (e.key) {
          case "Backspace":
            if (e.currentTarget.value === "") {
              e.preventDefault();
              const newTags = [...tags];
              newTags.splice(tagCount - 1, 1);
              setTags(newTags);
              setTagCount(newTags.length);
            }
            break;
        }
      }
    };

    const removeTag = (idToRemove: string) => {
      setTags(tags.filter((tag) => tag.id !== idToRemove));
      onTagRemove?.(tags.find((tag) => tag.id === idToRemove)?.text || "");
      setTagCount((prevTagCount) => prevTagCount - 1);
    };

    const truncatedTags = truncate
      ? tags.map((tag) => ({
          id: tag.id,
          text:
            tag.text?.length > truncate
              ? `${tag.text.substring(0, truncate)}...`
              : tag.text,
        }))
      : tags;

    return (
      <div
        className={`flex w-full ${
          inputFieldPosition === "bottom"
            ? "flex-col"
            : inputFieldPosition === "top"
            ? "flex-col-reverse"
            : "flex-row"
        }`}
      >
        <div className="w-full">
          <div
            className={cn(
              `flex w-full flex-row flex-wrap items-center gap-2 rounded-md border border-input bg-background p-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`,
              styleClasses?.inlineTagsContainer,
            )}
          >
            <TagList
              tags={truncatedTags}
              customTagRenderer={customTagRenderer}
              variant={variant}
              size={size}
              shape={shape}
              borderStyle={borderStyle}
              textCase={textCase}
              interaction={interaction}
              animation={animation}
              textStyle={textStyle}
              onTagClick={onTagClick}
              onRemoveTag={removeTag}
              direction={direction}
              activeTagIndex={activeTagIndex}
              setActiveTagIndex={setActiveTagIndex}
              classStyleProps={{
                tagClasses: styleClasses?.tag,
              }}
              disabled={disabled}
            />
            <Input
              ref={inputRef}
              id={id}
              type="text"
              placeholder={
                maxTags !== undefined && tags.length >= maxTags
                  ? placeholderWhenFull
                  : placeholder
              }
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              {...inputProps}
              className={cn(
                "h-5 w-fit flex-1 border-0 bg-transparent px-1.5 focus-visible:ring-0 focus-visible:ring-transparent focus-visible:ring-offset-0",
                styleClasses?.input,
              )}
              disabled={
                disabled || (maxTags !== undefined && tags.length >= maxTags)
              }
            />
          </div>
        </div>

        {showCount && maxTags && (
          <div className="flex">
            <span className="ml-auto mt-1 text-sm text-muted-foreground">
              {`${tagCount}`}/{`${maxTags}`}
            </span>
          </div>
        )}
      </div>
    );
  },
);

TagInput.displayName = "TagInput";

export { TagInput };
